import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  PromptTemplate,
} from '@langchain/core/prompts';
import {
  RunnableLambda,
  RunnableMap,
  RunnableSequence,
} from '@langchain/core/runnables';
import { BaseMessage, BaseMessageLike } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import LineListOutputParser from '../outputParsers/listLineOutputParser';
import LineOutputParser from '../outputParsers/lineOutputParser';
import { getDocumentsFromLinks } from '../utils/documents';
import { Document } from '@langchain/core/documents';
import path from 'node:path';
import fs from 'node:fs';
import computeSimilarity from '../utils/computeSimilarity';
import formatChatHistoryAsString from '../utils/formatHistory';
import eventEmitter from 'events';
import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { sanitizeLlmOutput } from '../utils/llmOutput';
import { fetchOpenbbMcpDocsForQuery } from '@/lib/openbb/mcp';
import { executeSearch } from './executeSearch';

export interface MetaSearchAgentType {
  searchAndAnswer: (
    message: string,
    history: BaseMessage[],
    llm: BaseChatModel,
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    fileIds: string[],
    systemInstructions: string,
  ) => Promise<eventEmitter>;
}

interface Config {
  searchWeb: boolean;
  rerank: boolean;
  rerankThreshold: number;
  queryGeneratorPrompt: string;
  queryGeneratorFewShots: BaseMessageLike[];
  responsePrompt: string;
  activeEngines: string[];
}

const emitStatus = (emitter: eventEmitter, text: string) => {
  emitter.emit(
    'data',
    JSON.stringify({
      type: 'status',
      data: text,
    }),
  );
};

type BasicChainInput = {
  chat_history: BaseMessage[];
  query: string;
};

type SourceEmitter = (docs: Document[]) => void;

const safeEmitSources = (emitter: eventEmitter, docs: Document[]) => {
  if (!Array.isArray(docs) || docs.length === 0) return;

  emitter.emit(
    'data',
    JSON.stringify({
      type: 'sources',
      data: docs.map((doc) => ({
        pageContent: doc.pageContent,
        metadata: doc.metadata,
      })),
    }),
  );
};

const MAX_LINKS_PER_SEARCH = 3;
const MAX_WEB_DOCS = 12;
const MAX_FINANCE_MARKET_ROWS = 24;
const MAX_FINANCE_MACRO_ROWS = 36;
const MAX_FINANCE_NEWS_ROWS = 20;
const MAX_OPENBB_DOCS = 2;
const STREAM_GUARD_TIMEOUT_MS = 45000;

const FINANCE_QUERY_RE =
  /股票|个股|A股|港股|美股|欧股|日股|投资|投研|估值|目标价|买入|卖出|持仓|收益率|回撤|资产配置|组合|基金|期货|外汇|利率|债券|宏观|CPI|PPI|PMI|GDP|非农|社融|信贷|财政|国债|美债|reits|commodit|bond|yield|equity|fx|macro|earnings|valuation/i;

const detectQueryLanguage = (query: string): 'zh-CN' | 'en' => {
  if (/[\u4e00-\u9fff]/.test(query)) return 'zh-CN';
  return 'en';
};

const extractUrlsFromText = (text: string) => {
  const urls = Array.from(
    new Set((text.match(/https?:\/\/[^\s<>()]+/gi) ?? []).map((u) => u.trim())),
  )
    .map((u) => u.replace(/[)\].,;]+$/g, ''))
    .filter((u) => u.length > 8);

  return urls;
};

const detectFinanceQuery = (query: string) => FINANCE_QUERY_RE.test(query);

const normalizeDocDedupKey = (doc: Document) => {
  const url = String(doc.metadata?.url ?? '').trim().toLowerCase();
  if (url) return `url:${url}`;
  const title = String(doc.metadata?.title ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `title:${title}`;
};

const dedupeDocs = (docs: Document[], max = MAX_WEB_DOCS) => {
  const seen = new Set<string>();
  const output: Document[] = [];

  for (const doc of docs) {
    const key = normalizeDocDedupKey(doc);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(doc);
    if (output.length >= max) break;
  }

  return output;
};

const isUrlSummaryQuery = (query: string) =>
  /^\s*summary\s*:/i.test(query) ||
  (/https?:\/\//i.test(query) && /summary|summar|摘要|总结/i.test(query));

const buildDeterministicUrlSummary = (docs: Document[]) => {
  const title = String(docs?.[0]?.metadata?.title ?? '').trim() || '网页摘要';
  const combined = docs.map((d) => d.pageContent || '').join('\n');
  const text = combined.replace(/\s+/g, ' ').trim();

  const items: string[] = [];

  // Try to extract enumerated Chinese list items (e.g. "1、... 2、...").
  for (const m of text.matchAll(
    /(\d{1,2})[、.．]\s*([\s\S]{5,220}?)(?=(?:\s*\d{1,2}[、.．]\s*)|$)/g,
  )) {
    const item = String(m[2] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[;；。\.]+$/g, '');
    if (!item) continue;
    // Drop obvious boilerplate.
    if (/免责声明|风险提示|不承担任何责任/i.test(item)) continue;
    items.push(item);
    if (items.length >= 15) break;
  }

  const bullets =
    items.length > 0
      ? items.slice(0, 12).map((t) => `- ${t}`).join('\n')
      : (() => {
          const sentences = text
            .split(/[。！？；;]+/g)
            .map((s) => s.trim())
            .filter((s) => s.length >= 12 && s.length <= 120)
            .filter((s) => !/免责声明|风险提示|不承担任何责任/i.test(s));
          const uniq = Array.from(new Set(sentences)).slice(0, 10);
          return uniq.length
            ? uniq.map((t) => `- ${t}`).join('\n')
            : '- 未能从页面抽取到足够正文。';
        })();

  return (
    `## 摘要\n\n${title}（基于页面正文自动抽取与归纳）。\n\n` +
    `## 核心要点\n\n${bullets}\n\n` +
    `## 可能影响\n\n` +
    `- 如涉及宏观/政策/地缘事件，可能影响风险偏好与相关行业板块定价。\n` +
    `- 建议结合更多来源交叉验证，并关注后续数据/公告更新。\n`
  );
};

class MetaSearchAgent implements MetaSearchAgentType {
  private config: Config;
  private strParser = new StringOutputParser();

  constructor(config: Config) {
    this.config = config;
  }

  private readJsonFile<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private buildHardFallbackAnswer(query: string) {
    const isFinance = detectFinanceQuery(query);

    if (isFinance) {
      return (
        '## 当前状态\n' +
        '- 本次模型生成中断，已启用硬兜底输出。\n\n' +
        '## 先给你可执行框架\n' +
        '- **结论模板**：先写“核心结论（一句话）→ 驱动因子（3条）→ 反证条件（2条）”。\n' +
        '- **必看数据**：估值（PE/PB/EV-EBITDA）、盈利预期（未来4季）、现金流、利率与风险溢价。\n' +
        '- **情景推演**：基准/乐观/悲观三情景，分别给出关键假设和估值区间。\n' +
        '- **风险控制**：列出触发止损或降权重的客观条件（如盈利下修、政策变化、信用利差走阔）。\n\n' +
        '## 你可以直接补充这3项，我会继续产出完整投研结论\n' +
        '- 1) 标的代码/资产名称\n' +
        '- 2) 投资期限（短线/中线/长期）\n' +
        '- 3) 你最关注的维度（估值/基本面/交易拥挤度/宏观）\n'
      );
    }

    return (
      '## 当前状态\n' +
      '- 本次生成被中断，已触发回答兜底。\n\n' +
      '## 建议下一步\n' +
      '- 换一个更具体的关键词（可加时间、地点、主体）。\n' +
      '- 如果是链接摘要，请直接贴原文链接并加“Summary:”。\n' +
      '- 如需我重试，请回复“重试并缩短答案”。\n'
    );
  }

  private buildFinanceBypassDocs(query: string): Document[] {
    const dataRoot = process.env.DATA_DIR || process.cwd();
    const economyPath = path.join(dataRoot, 'data/economy-cache.json');
    const newsPath = path.join(dataRoot, 'data/news-cache.json');

    const economy = this.readJsonFile<{
      data?: { market?: any[]; macro?: any[] };
      updatedAt?: number;
      marketUpdatedAt?: number;
      macroUpdatedAt?: number;
    }>(economyPath);
    const news = this.readJsonFile<{
      updatedAt?: string;
      items?: Array<{
        title?: string;
        source?: string;
        datetime?: string;
        publishTime?: string;
        url?: string;
        sourceUrl?: string;
      }>;
    }>(newsPath);

    const market = Array.isArray(economy?.data?.market) ? economy!.data!.market! : [];
    const macro = Array.isArray(economy?.data?.macro) ? economy!.data!.macro! : [];
    const newsItems = Array.isArray(news?.items) ? news!.items! : [];

    const queryLower = query.toLowerCase();
    const marketFiltered = market.filter((m) => {
      const text = `${m?.id ?? ''} ${m?.name ?? ''} ${m?.region ?? ''}`.toLowerCase();
      return !queryLower || text.includes(queryLower) || queryLower.includes(String(m?.id ?? '').toLowerCase());
    });
    const macroFiltered = macro.filter((m) => {
      const text = `${m?.id ?? ''} ${m?.name ?? ''} ${m?.region ?? ''}`.toLowerCase();
      return !queryLower || text.includes(queryLower);
    });

    const marketRows = (marketFiltered.length ? marketFiltered : market)
      .slice(0, MAX_FINANCE_MARKET_ROWS)
      .map((m) =>
        `- ${m.name} (${m.id}, ${m.region}) 最新=${m.close ?? '--'}${m.unit ?? ''} 变动=${Number.isFinite(Number(m.pct_chg)) ? Number(m.pct_chg).toFixed(2) + '%' : '--'} 日期=${m.trade_date ?? '--'}`,
      )
      .join('\n');

    const macroRows = (macroFiltered.length ? macroFiltered : macro)
      .slice(0, MAX_FINANCE_MACRO_ROWS)
      .map((m) =>
        `- ${m.name} (${m.id}, ${m.region}) 最新=${m.value ?? '--'}${m.unit ?? ''} 上期=${m.prev_value ?? '--'}${m.unit ?? ''} 频率=${m.frequency ?? '--'} 期次=${m.period ?? '--'}`,
      )
      .join('\n');

    const newsRows = newsItems
      .slice(0, MAX_FINANCE_NEWS_ROWS)
      .map((item) => {
        const rawTime = item.datetime || item.publishTime;
        const when = rawTime ? new Date(rawTime).toISOString() : '--';
        const title = String(item.title ?? '').trim() || '未命名快讯';
        const source = String(item.source ?? '').trim() || '未知来源';
        const link = String(item.url || item.sourceUrl || '').trim() || '--';
        return `- ${title} | 来源=${source} | 时间=${when} | 链接=${link}`;
      })
      .join('\n');

    const docs: Document[] = [];

    if (marketRows) {
      docs.push(
        new Document({
          pageContent:
            `金融直连数据（市场快照）。更新时间：${new Date(
              economy?.marketUpdatedAt || economy?.updatedAt || Date.now(),
            ).toISOString()}\n` + marketRows,
          metadata: {
            title: '金融数据直连：市场快照',
            url: 'local://economy-cache/market',
          },
        }),
      );
    }

    if (macroRows) {
      docs.push(
        new Document({
          pageContent:
            `金融直连数据（宏观指标）。更新时间：${new Date(
              economy?.macroUpdatedAt || economy?.updatedAt || Date.now(),
            ).toISOString()}\n` + macroRows,
          metadata: {
            title: '金融数据直连：宏观指标',
            url: 'local://economy-cache/macro',
          },
        }),
      );
    }

    if (newsRows) {
      docs.push(
        new Document({
          pageContent:
            `金融快讯（本地缓存，按时间倒序）。更新时间：${news?.updatedAt ?? '--'}\n` +
            newsRows,
          metadata: {
            title: '金融数据直连：财经快讯',
            url: 'local://news-cache/top',
          },
        }),
      );
    }

    return docs;
  }

  private async fetchWebDocsHybrid(question: string): Promise<Document[]> {
    const query = question.trim().slice(0, 500);
    if (!query) return [];

    const language = detectQueryLanguage(query);
    const mode = this.config.activeEngines.includes('youtube')
      ? 'multimodal'
      : this.config.activeEngines.includes('arxiv') ||
          this.config.activeEngines.includes('google scholar') ||
          this.config.activeEngines.includes('pubmed')
        ? 'academic'
        : this.config.activeEngines.includes('reddit')
          ? 'social'
          : detectFinanceQuery(query)
            ? 'finance'
            : 'web';

    const result = await executeSearch(query, mode, {
      engines: this.config.activeEngines,
      language,
      useTavily: this.config.activeEngines.length === 0,
      allowScrape: true,
    });

    return dedupeDocs(result.docs, MAX_WEB_DOCS);
  }

  private async fetchOpenbbMcpDocs(query: string): Promise<Document[]> {
    try {
      const docs = await fetchOpenbbMcpDocsForQuery(query);
      return docs.slice(0, MAX_OPENBB_DOCS);
    } catch (err) {
      console.warn('[metaSearchAgent] openbb mcp fetch failed:', err);
      return [];
    }
  }

  private async createSearchRetrieverChain(llm: BaseChatModel) {
    (llm as unknown as ChatOpenAI).temperature = 0;

    return RunnableSequence.from([
      ChatPromptTemplate.fromMessages([
        ['system', this.config.queryGeneratorPrompt],
        ...this.config.queryGeneratorFewShots,
        [
          'user',
          `
        <conversation>
        {chat_history}
        </conversation>

        <query>
        {query}
        </query>
       `,
        ],
      ]),
      llm,
      this.strParser,
      RunnableLambda.from(async (input: string) => {
        const linksOutputParser = new LineListOutputParser({
          key: 'links',
        });

        const questionOutputParser = new LineOutputParser({
          key: 'question',
        });

        const cleanedInput = sanitizeLlmOutput(input);
        const links = await linksOutputParser.parse(cleanedInput);
        let question = (await questionOutputParser.parse(cleanedInput)) ?? '';

        if (!question) {
          const queryTag =
            cleanedInput.match(/<query>\s*([\s\S]*?)\s*<\/query>/i)?.[1] ??
            '';
          question = queryTag || cleanedInput;
        }

        question = question.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        if (/tool\s*=>|args\s*=>/i.test(question)) {
          const queryTag =
            cleanedInput.match(/<query>\s*([\s\S]*?)\s*<\/query>/i)?.[1] ??
            '';
          if (queryTag.trim()) {
            question = queryTag.trim();
          }
        }

        const limitedLinks = Array.from(
          new Set(
            links
              .map((link) => link.trim())
              .filter((link) => link.length > 0),
          ),
        ).slice(0, MAX_LINKS_PER_SEARCH);

        if (question.length > 500) {
          question = question.slice(0, 500);
        }

        if (!question || question.toLowerCase() === 'not_needed') {
          return { query: '', docs: [] };
        }

        if (limitedLinks.length > 0) {
          if (question.length === 0) {
            question = 'summarize';
          }

          let docs: Document[] = [];

          const linkDocs = await getDocumentsFromLinks({ links: limitedLinks });

          const docGroups: Document[] = [];

          linkDocs.map((doc) => {
            const URLDocExists = docGroups.find(
              (d) =>
                d.metadata.url === doc.metadata.url &&
                d.metadata.totalDocs < 10,
            );

            if (!URLDocExists) {
              docGroups.push({
                ...doc,
                metadata: {
                  ...doc.metadata,
                  totalDocs: 1,
                },
              });
            }

            const docIndex = docGroups.findIndex(
              (d) =>
                d.metadata.url === doc.metadata.url &&
                d.metadata.totalDocs < 10,
            );

            if (docIndex !== -1) {
              docGroups[docIndex].pageContent =
                docGroups[docIndex].pageContent + `\n\n` + doc.pageContent;
              docGroups[docIndex].metadata.totalDocs += 1;
            }
          });

          await Promise.all(
            docGroups.map(async (doc) => {
              const res = await llm.invoke(`
            You are a web search summarizer, tasked with summarizing a piece of text retrieved from a web search. Your job is to summarize the 
            text into a detailed, 2-4 paragraph explanation that captures the main ideas and provides a comprehensive answer to the query.
            If the query is \"summarize\", you should provide a detailed summary of the text. If the query is a specific question, you should answer it in the summary.
            
            - **Journalistic tone**: The summary should sound professional and journalistic, not too casual or vague.
            - **Thorough and detailed**: Ensure that every key point from the text is captured and that the summary directly answers the query.
            - **Not too lengthy, but detailed**: The summary should be informative but not excessively long. Focus on providing detailed information in a concise format.

            The text will be shared inside the \`text\` XML tag, and the query inside the \`query\` XML tag.

            <example>
            1. \`<text>
            Docker is a set of platform-as-a-service products that use OS-level virtualization to deliver software in packages called containers. 
            It was first released in 2013 and is developed by Docker, Inc. Docker is designed to make it easier to create, deploy, and run applications 
            by using containers.
            </text>

            <query>
            What is Docker and how does it work?
            </query>

            Response:
            Docker is a revolutionary platform-as-a-service product developed by Docker, Inc., that uses container technology to make application 
            deployment more efficient. It allows developers to package their software with all necessary dependencies, making it easier to run in 
            any environment. Released in 2013, Docker has transformed the way applications are built, deployed, and managed.
            \`
            2. \`<text>
            The theory of relativity, or simply relativity, encompasses two interrelated theories of Albert Einstein: special relativity and general
            relativity. However, the word "relativity" is sometimes used in reference to Galilean invariance. The term "theory of relativity" was based
            on the expression "relative theory" used by Max Planck in 1906. The theory of relativity usually encompasses two interrelated theories by
            Albert Einstein: special relativity and general relativity. Special relativity applies to all physical phenomena in the absence of gravity.
            General relativity explains the law of gravitation and its relation to other forces of nature. It applies to the cosmological and astrophysical
            realm, including astronomy.
            </text>

            <query>
            summarize
            </query>

            Response:
            The theory of relativity, developed by Albert Einstein, encompasses two main theories: special relativity and general relativity. Special
            relativity applies to all physical phenomena in the absence of gravity, while general relativity explains the law of gravitation and its
            relation to other forces of nature. The theory of relativity is based on the concept of "relative theory," as introduced by Max Planck in
            1906. It is a fundamental theory in physics that has revolutionized our understanding of the universe.
            \`
            </example>

            Everything below is the actual data you will be working with. Good luck!

            <query>
            ${question}
            </query>

            <text>
            ${doc.pageContent}
            </text>

            Make sure to answer the query in the summary.
          `);

              const document = new Document({
                pageContent: res.content as string,
                metadata: {
                  title: doc.metadata.title,
                  url: doc.metadata.url,
                },
              });

              docs.push(document);
            }),
          );

          return { query: question, docs: docs };
        } else {
          try {
            const docs = await this.fetchWebDocsHybrid(question);
            return { query: question, docs };
          } catch (err) {
            console.error(
              '[metaSearchAgent] hybrid web search failed, fallback to empty docs',
              err,
            );
            return { query: question, docs: [] };
          }
        }
      }),
    ]);
  }

  private async createAnsweringChain(
    llm: BaseChatModel,
    fileIds: string[],
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    systemInstructions: string,
    sourceEmitter?: SourceEmitter,
  ) {
    return RunnableSequence.from([
      RunnableMap.from({
        systemInstructions: () => systemInstructions,
        query: (input: BasicChainInput) => input.query,
        chat_history: (input: BasicChainInput) => input.chat_history,
        date: () => new Date().toISOString(),
        context: RunnableLambda.from(async (input: BasicChainInput) => {
          const processedHistory = formatChatHistoryAsString(
            input.chat_history,
          );

          let docs: Document[] | null = null;
          let query = input.query;

          if (this.config.searchWeb) {
            const urls = extractUrlsFromText(query);
            const wantsSummary = urls.length > 0 && isUrlSummaryQuery(query);

            if (wantsSummary) {
              // Deterministic URL summary: fetch link content directly instead of relying on
              // the model to output a <links> block (some providers are inconsistent).
              docs = await getDocumentsFromLinks({
                links: urls.slice(0, MAX_LINKS_PER_SEARCH),
              });
            } else if (optimizationMode === 'speed') {
              docs = await this.fetchWebDocsHybrid(query);
            } else {
              try {
                const searchRetrieverChain =
                  await this.createSearchRetrieverChain(llm);

                const searchRetrieverResult = await searchRetrieverChain.invoke({
                  chat_history: processedHistory,
                  query,
                });

                query = searchRetrieverResult.query;
                docs = searchRetrieverResult.docs;

                if (!docs || docs.length === 0) {
                  docs = await this.fetchWebDocsHybrid(input.query);
                }
              } catch (err) {
                console.error(
                  '[metaSearchAgent] retriever chain failed, fallback to direct search',
                  err,
                );
                docs = await this.fetchWebDocsHybrid(query);
              }
            }

            if (optimizationMode !== 'speed' && detectFinanceQuery(query)) {
              const [openbbDocs] = await Promise.all([
                this.fetchOpenbbMcpDocs(query),
              ]);
              const localFinanceDocs = this.buildFinanceBypassDocs(query);

              if (!docs || docs.length === 0) {
                docs = [...openbbDocs, ...localFinanceDocs];
              } else {
                docs = [...openbbDocs, ...docs, ...localFinanceDocs];
              }

              docs = dedupeDocs(docs, MAX_WEB_DOCS + MAX_OPENBB_DOCS + 4);
            }
          }

          const sortedDocs = await this.rerankDocs(
            query,
            docs ?? [],
            fileIds,
            embeddings,
            optimizationMode,
          );
          sourceEmitter?.(sortedDocs);

          return sortedDocs;
        })
          .withConfig({
            runName: 'FinalSourceRetriever',
          })
          .pipe(this.processDocs),
      }),
      ChatPromptTemplate.fromMessages([
        ['system', this.config.responsePrompt],
        new MessagesPlaceholder('chat_history'),
        ['user', '{query}'],
      ]),
      llm,
      this.strParser,
    ]).withConfig({
      runName: 'FinalResponseGenerator',
    });
  }

  private async rerankDocs(
    query: string,
    docs: Document[],
    fileIds: string[],
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
  ) {
    if (docs.length === 0 && fileIds.length === 0) {
      return docs;
    }

    const filesData = fileIds
      .map((file) => {
        try {
          const filePath = path.join(process.cwd(), 'uploads', file);

          const contentPath = filePath + '-extracted.json';
          const embeddingsPath = filePath + '-embeddings.json';

          const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
          const embeddings = JSON.parse(
            fs.readFileSync(embeddingsPath, 'utf8'),
          );

          const fileSimilaritySearchObject = content.contents.map(
            (c: string, i: number) => {
              return {
                fileName: content.title,
                content: c,
                embeddings: embeddings.embeddings[i],
              };
            },
          );

          return fileSimilaritySearchObject;
        } catch (err) {
          console.warn('[metaSearchAgent] skip invalid upload embeddings', file);
          return [];
        }
      })
      .flat();

    if (query.toLocaleLowerCase() === 'summarize') {
      return docs.slice(0, 15);
    }

    const docsWithContent = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.length > 0,
    );

    if (optimizationMode === 'speed' || this.config.rerank === false) {
      if (filesData.length > 0) {
        const [queryEmbedding] = await Promise.all([
          embeddings.embedQuery(query),
        ]);

        const fileDocs = filesData.map((fileData) => {
          return new Document({
            pageContent: fileData.content,
            metadata: {
              title: fileData.fileName,
              url: `File`,
            },
          });
        });

        const similarity = filesData.map((fileData, i) => {
          const sim = computeSimilarity(queryEmbedding, fileData.embeddings);

          return {
            index: i,
            similarity: sim,
          };
        });

        let sortedDocs = similarity
          .filter(
            (sim) => sim.similarity > (this.config.rerankThreshold ?? 0.3),
          )
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 15)
          .map((sim) => fileDocs[sim.index]);

        sortedDocs =
          docsWithContent.length > 0 ? sortedDocs.slice(0, 8) : sortedDocs;

        return [
          ...sortedDocs,
          ...docsWithContent.slice(0, 15 - sortedDocs.length),
        ];
      } else {
        return docsWithContent.slice(0, 15);
      }
    } else if (optimizationMode === 'balanced') {
      const [docEmbeddings, queryEmbedding] = await Promise.all([
        embeddings.embedDocuments(
          docsWithContent.map((doc) => doc.pageContent),
        ),
        embeddings.embedQuery(query),
      ]);

      docsWithContent.push(
        ...filesData.map((fileData) => {
          return new Document({
            pageContent: fileData.content,
            metadata: {
              title: fileData.fileName,
              url: `File`,
            },
          });
        }),
      );

      docEmbeddings.push(...filesData.map((fileData) => fileData.embeddings));

      const similarity = docEmbeddings.map((docEmbedding, i) => {
        const sim = computeSimilarity(queryEmbedding, docEmbedding);

        return {
          index: i,
          similarity: sim,
        };
      });

      const sortedDocs = similarity
        .filter((sim) => sim.similarity > (this.config.rerankThreshold ?? 0.3))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15)
        .map((sim) => docsWithContent[sim.index]);

      return sortedDocs;
    }

    return [];
  }

  private processDocs(docs: Document[]) {
    return docs
      .map(
        (_, index) =>
          `${index + 1}. ${docs[index].metadata.title} ${docs[index].pageContent}`,
      )
      .join('\n');
  }

  private async handleStream(
    stream: AsyncGenerator<StreamEvent, any, any>,
    emitter: eventEmitter,
    opts?: { summaryMode?: boolean; summaryUrls?: string[]; query?: string },
  ) {
    const summaryMode = Boolean(opts?.summaryMode);
    const summaryUrls = opts?.summaryUrls ?? [];
    const query = opts?.query ?? '';
    let ended = false;
    let sawResponseChunk = false;
    let streamGuard: NodeJS.Timeout | null = null;

    const endOnce = () => {
      if (ended) return;
      ended = true;
      if (streamGuard) {
        clearTimeout(streamGuard);
        streamGuard = null;
      }
      emitter.emit('end');
    };

    const extractFinalOutputText = (output: unknown): string => {
      if (!output) return '';
      if (typeof output === 'string') return output;
      if (typeof output === 'object') {
        const anyOutput = output as any;
        if (typeof anyOutput.content === 'string') return anyOutput.content;
        if (Array.isArray(anyOutput.content)) {
          const merged = anyOutput.content
            .map((item: any) =>
              typeof item === 'string'
                ? item
                : typeof item?.text === 'string'
                  ? item.text
                  : '',
            )
            .join('');
          if (merged.trim()) return merged;
        }
      }
      return '';
    };

    streamGuard = setTimeout(() => {
      if (ended) return;

      if (!sawResponseChunk) {
        emitter.emit(
          'data',
          JSON.stringify({
            type: 'response',
            data: this.buildHardFallbackAnswer(query),
          }),
        );
      }

      endOnce();
    }, STREAM_GUARD_TIMEOUT_MS);

    try {
      for await (const event of stream) {
        if (ended) continue;

        if (
          this.config.searchWeb &&
          event.event === 'on_chain_start' &&
          event.name === 'FinalSourceRetriever'
        ) {
          emitStatus(emitter, '正在检索网页来源...');
        }

        if (
          this.config.searchWeb &&
          event.event === 'on_chain_end' &&
          event.name === 'FinalSourceRetriever'
        ) {
          emitStatus(emitter, '已获取来源，正在组织回答...');
          if (Array.isArray(event.data?.output)) {
            safeEmitSources(emitter, event.data.output);
          }
        }
        if (
          event.event === 'on_chain_stream' &&
          event.name === 'FinalResponseGenerator'
        ) {
          const chunkText = extractFinalOutputText(event.data?.chunk);
          if (chunkText.trim()) {
            if (!sawResponseChunk) {
              emitStatus(emitter, '正在生成回答...');
            }
            sawResponseChunk = true;
          emitter.emit(
            'data',
              JSON.stringify({ type: 'response', data: chunkText }),
          );
          }
        }
        if (
          event.event === 'on_chain_end' &&
          event.name === 'FinalResponseGenerator'
        ) {
          if (!sawResponseChunk) {
            const finalText = extractFinalOutputText(event.data?.output);
            if (finalText.trim()) {
              sawResponseChunk = true;
              emitter.emit(
                'data',
                JSON.stringify({
                  type: 'response',
                  data: finalText,
                }),
              );
            } else {
              emitter.emit(
                'data',
                JSON.stringify({
                  type: 'response',
                  data: this.buildHardFallbackAnswer(query),
                }),
              );
              sawResponseChunk = true;
            }
          }
          endOnce();
        }
      }

      if (!sawResponseChunk && !ended) {
        emitter.emit(
          'data',
          JSON.stringify({
            type: 'response',
            data: this.buildHardFallbackAnswer(query),
          }),
        );
      }
      endOnce();
    } catch (err: any) {
      // Some providers (e.g. safety filters) may abort streaming without emitting a final
      // event. Always end the stream so API handlers don't hang.
      if (summaryMode && summaryUrls.length > 0) {
        try {
          const docs = await getDocumentsFromLinks({
            links: summaryUrls.slice(0, MAX_LINKS_PER_SEARCH),
          });
          const raw = docs
            .map((d) => d.pageContent)
            .join('\n')
            .slice(0, 12000);
          const normalized = raw.replace(/\s+/g, ' ').trim();
          const sentences = normalized
            .split(/[。！？\n]+/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 10);
          const points = Array.from(new Set(sentences)).slice(0, 12);

          const bullet = points.length
            ? points.map((p) => `- ${p}`).join('\n')
            : '- 未能从页面抽取到足够正文。';

          emitter.emit(
            'data',
            JSON.stringify({
              type: 'response',
              data:
                `## 摘要\n模型生成被拦截或中断，以下为基于网页抽取文本的简要提要（可能不完整）。\n\n` +
                `## 核心要点\n${bullet}\n\n` +
                `## 可能影响\n- 建议结合市场数据与更多来源交叉验证。\n`,
            }),
          );
        } catch {}
      } else {
        emitter.emit(
          'data',
          JSON.stringify({
            type: 'response',
            data: this.buildHardFallbackAnswer(query),
          }),
        );
      }

      endOnce();
    }
  }

  async searchAndAnswer(
    message: string,
    history: BaseMessage[],
    llm: BaseChatModel,
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    fileIds: string[],
    systemInstructions: string,
  ) {
    const emitter = new eventEmitter();

    const urls = extractUrlsFromText(message);
    const wantsSummary = urls.length > 0 && isUrlSummaryQuery(message);
    let sourcesEmitted = false;
    const emitSourcesOnce: SourceEmitter = (docs) => {
      if (sourcesEmitted || !Array.isArray(docs) || docs.length === 0) return;
      sourcesEmitted = true;
      safeEmitSources(emitter, docs);
    };

    // URL summary is a product-critical path (clicking a news item). Some providers
    // are prone to meta narration; do a deterministic summary to guarantee usefulness.
    if (wantsSummary) {
      // Important: emit asynchronously so the caller has time to attach listeners.
      void (async () => {
        try {
          emitStatus(emitter, '正在抓取链接内容...');
          const docs = await getDocumentsFromLinks({
            links: urls.slice(0, MAX_LINKS_PER_SEARCH),
          });
          safeEmitSources(emitter, docs);
          emitter.emit(
            'data',
            JSON.stringify({
              type: 'response',
              data: buildDeterministicUrlSummary(docs),
            }),
          );
        } catch (err) {
          emitter.emit(
            'data',
            JSON.stringify({
              type: 'response',
              data:
                '## 摘要\n\n未能获取页面正文内容。\n\n## 核心要点\n- 可能是页面反爬/超时/临时不可达。\n\n## 可能影响\n- 建议稍后重试，或换一个来源链接。\n',
            }),
          );
        } finally {
          emitter.emit('end');
        }
      })();

      return emitter;
    }

    const answeringChain = await this.createAnsweringChain(
      llm,
      fileIds,
      embeddings,
      optimizationMode,
      systemInstructions,
      emitSourcesOnce,
    );

    const stream = answeringChain.streamEvents(
      {
        chat_history: history,
        query: message,
      },
      {
        version: 'v1',
      },
    );

    void this.handleStream(stream, emitter, {
      summaryMode: false,
      summaryUrls: [],
      query: message,
    });

    return emitter;
  }
}

export default MetaSearchAgent;
