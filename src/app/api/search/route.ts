import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { MetaSearchAgentType } from '@/lib/search/metaSearchAgent';
import { searchHandlers } from '@/lib/search';
import ModelRegistry from '@/lib/models/registry';
import { ModelWithProvider } from '@/lib/models/types';
import { parseLooseJson } from '@/lib/utils/json';
import { sanitizeLlmOutput } from '@/lib/utils/llmOutput';

const detectSummaryQuery = (query: string) =>
  /^\s*summary\s*:/i.test(query) ||
  (/https?:\/\//i.test(query) && /summary|summar|摘要|总结/i.test(query));

const detectFinanceQuery = (query: string) =>
  /股票|个股|A股|港股|美股|投资|投研|估值|目标价|买入|卖出|持仓|收益率|回撤|资产配置|组合|基金|期货|外汇|利率|债券|宏观|CPI|PPI|PMI/i.test(
    query,
  );

const trimToFirstHeading = (text: string) => {
  const idx = text.search(/(^|\n)##\s+/);
  if (idx === -1) return text.trim();
  return (idx === 0 ? text : text.slice(idx + 1)).trim();
};

const ensureSummaryHeading = (text: string) => {
  const trimmed = text.trimStart();
  if (!trimmed) return '';
  return trimmed.startsWith('## 摘要') ? trimmed : `## 摘要\n\n${trimmed}`;
};

interface ChatRequestBody {
  optimizationMode: 'speed' | 'balanced';
  focusMode: string;
  chatModel: ModelWithProvider;
  embeddingModel: ModelWithProvider;
  query: string;
  history: Array<[string, string]>;
  stream?: boolean;
  systemInstructions?: string;
}

const safeParseEmitterData = (raw: unknown) => {
  const parsed = parseLooseJson<{ type?: string; data?: any }>(raw);
  if (!parsed) {
    console.warn('[search route] Failed to parse emitter event payload');
    return null;
  }

  return parsed;
};


const buildEffectiveSystemInstructions = (
  query: string,
  systemInstructions?: string | null,
) => {
  const isSummaryQuery = /^\s*summary\s*:/i.test(query) ||
    (/https?:\/\//i.test(query) && /summary|summar|摘要|总结/i.test(query));
  const isFinanceQuery = detectFinanceQuery(query);

  const extras: string[] = [];

  if (isSummaryQuery) {
    extras.push(
      '你正在执行新闻URL摘要任务。只输出最终摘要，不要输出过程性描述、能力限制说明或自我对话。默认使用中文，并按以下结构：## 摘要\n## 核心要点\n## 可能影响。',
    );
  }

  if (!isSummaryQuery && isFinanceQuery) {
    extras.push(
      '金融内容合规要求：仅做信息整理与研究框架/情景分析，不提供个性化投资建议；避免明确“买入/卖出/强烈推荐”等措辞；用数据与逻辑说明观点，并给出主要风险点与不确定性。',
    );
  }

  return [systemInstructions || '', ...extras].filter(Boolean).join('\n');
};

export const POST = async (req: Request) => {
  try {
    const body: ChatRequestBody = await req.json();
    const summaryMode = detectSummaryQuery(body.query || '');

    if (!body.focusMode || !body.query) {
      return Response.json(
        { message: 'Missing focus mode or query' },
        { status: 400 },
      );
    }

    body.query = body.query.trim().slice(0, 2000);
    body.history = body.history || [];
    body.optimizationMode = body.optimizationMode || 'balanced';
    body.stream = body.stream || false;

    const history: BaseMessage[] = body.history.map((msg) => {
      return msg[0] === 'human'
        ? new HumanMessage({ content: msg[1] })
        : new AIMessage({ content: msg[1] });
    });

    const registry = new ModelRegistry();

    const [llm, embeddings] = await Promise.all([
      registry.loadChatModel(body.chatModel.providerId, body.chatModel.key),
      registry.loadEmbeddingModel(
        body.embeddingModel.providerId,
        body.embeddingModel.key,
      ),
    ]);

    const searchHandler: MetaSearchAgentType = searchHandlers[body.focusMode];

    if (!searchHandler) {
      return Response.json({ message: 'Invalid focus mode' }, { status: 400 });
    }

    const effectiveSystemInstructions = buildEffectiveSystemInstructions(
      body.query,
      body.systemInstructions || '',
    );

    const emitter = await searchHandler.searchAndAnswer(
      body.query,
      history,
      llm,
      embeddings,
      body.optimizationMode,
      [],
      effectiveSystemInstructions,
    );

    if (!body.stream) {
      return new Promise(
        (
          resolve: (value: Response) => void,
          reject: (value: Response) => void,
        ) => {
          let rawMessage = '';
          let sources: any[] = [];

          emitter.on('data', (data: string) => {
            const parsedData = safeParseEmitterData(data);
            if (!parsedData?.type) return;

            if (parsedData.type === 'response') {
              rawMessage += String(parsedData.data ?? '');
            } else if (parsedData.type === 'sources') {
              sources = parsedData.data ?? [];
            }
          });

          emitter.on('end', () => {
            let message = sanitizeLlmOutput(rawMessage);
            if (summaryMode) message = ensureSummaryHeading(trimToFirstHeading(message));
            resolve(Response.json({ message, sources }, { status: 200 }));
          });

          emitter.on('error', (error: any) => {
            reject(
              Response.json(
                { message: 'Search error', error },
                { status: 500 },
              ),
            );
          });
        },
      );
    }

    const encoder = new TextEncoder();

    const abortController = new AbortController();
    const { signal } = abortController;

    const stream = new ReadableStream({
      start(controller) {
        let sources: any[] = [];
        let rawMessage = '';
        let emittedMessage = '';
        let summaryTrimOffset: number | null = null;
        let summaryPrefixed = false;
        const summaryPrefix = '## 摘要\n\n';

        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'init',
              data: 'Stream connected',
            }) + '\n',
          ),
        );

        signal.addEventListener('abort', () => {
          emitter.removeAllListeners();

          try {
            controller.close();
          } catch {}
        });

        emitter.on('data', (data: string) => {
          if (signal.aborted) return;

          const parsedData = safeParseEmitterData(data);
          if (!parsedData?.type) return;

          if (parsedData.type === 'response') {
            rawMessage += String(parsedData.data ?? '');
            const cleaned = sanitizeLlmOutput(rawMessage);
            let effective = cleaned;

            if (summaryMode) {
              if (summaryTrimOffset === null) {
                const idx = effective.search(/(^|\n)##\s+/);
                if (idx === -1) return; // wait until headings appear
                summaryTrimOffset = idx === 0 ? 0 : idx + 1;
              }
              effective = effective.slice(summaryTrimOffset);
              if (!summaryPrefixed && !effective.trimStart().startsWith('## 摘要')) {
                effective = summaryPrefix + effective.trimStart();
                summaryPrefixed = true;
              }
            }
            const delta = effective.slice(emittedMessage.length);

            if (delta) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: 'response',
                    data: delta,
                  }) + '\n',
                ),
              );
              emittedMessage += delta;
            }
          } else if (parsedData.type === 'sources') {
            sources = parsedData.data ?? [];
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: 'sources',
                  data: sources,
                }) + '\n',
              ),
            );
          }
        });

        emitter.on('end', () => {
          if (signal.aborted) return;

          const finalClean = sanitizeLlmOutput(rawMessage);
          let effective = finalClean;

          if (summaryMode) {
            if (summaryTrimOffset === null) {
              const idx = effective.search(/(^|\n)##\s+/);
              summaryTrimOffset = idx === -1 ? 0 : idx === 0 ? 0 : idx + 1;
            }
            effective = effective.slice(summaryTrimOffset);
            if (!summaryPrefixed && !effective.trimStart().startsWith('## 摘要')) {
              effective = summaryPrefix + effective.trimStart();
              summaryPrefixed = true;
            }
          }

          const tail = effective.slice(emittedMessage.length);

          if (tail) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: 'response',
                  data: tail,
                }) + '\n',
              ),
            );
          }

          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'done',
              }) + '\n',
            ),
          );
          controller.close();
        });

        emitter.on('error', (error: any) => {
          if (signal.aborted) return;
          controller.error(error);
        });
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error(`Error in getting search results: ${err.message}`);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
