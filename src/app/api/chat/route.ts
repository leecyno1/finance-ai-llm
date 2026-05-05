import crypto from 'crypto';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { EventEmitter } from 'stream';
import db from '@/lib/db';
import { chats, messages as messagesSchema } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { getFileDetails } from '@/lib/utils/files';
import { getSearchHandlerCapabilities, searchHandlers } from '@/lib/search';
import ApiSearchAgent from '@/lib/search/apiSearchAgent';
import { z } from 'zod';
import ModelRegistry from '@/lib/models/registry';
import { loadRoutedChatModel, loadRoutedEmbeddingModel } from '@/lib/models/modelRouting';
import { ModelWithProvider } from '@/lib/models/types';
import { getClientIdFromHeaders } from '@/lib/server/client';
import { parseLooseJson } from '@/lib/utils/json';
import { sanitizeLlmOutput } from '@/lib/utils/llmOutput';
import {
  isBrokerResearchReportQuery,
  normalizeChatFocusMode,
  shouldBypassWebSearch,
} from '@/lib/search/intent';
import { buildResearchDataPack } from '@/lib/finance/researchDataPack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const messageSchema = z.object({
  messageId: z.string().min(1, 'Message ID is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  content: z.string().min(1, 'Message content is required'),
});

const chatModelSchema: z.ZodType<ModelWithProvider> = z.object({
  providerId: z.string({
    errorMap: () => ({
      message: 'Chat model provider id must be provided',
    }),
  }),
  key: z.string({
    errorMap: () => ({
      message: 'Chat model key must be provided',
    }),
  }),
});

const embeddingModelSchema: z.ZodType<ModelWithProvider> = z.object({
  providerId: z.string({
    errorMap: () => ({
      message: 'Embedding model provider id must be provided',
    }),
  }),
  key: z.string({
    errorMap: () => ({
      message: 'Embedding model key must be provided',
    }),
  }),
});

const bodySchema = z.object({
  message: messageSchema,
  optimizationMode: z.enum(['speed', 'balanced', 'quality'], {
    errorMap: () => ({
      message: 'Optimization mode must be one of: speed, balanced, quality',
    }),
  }),
  focusMode: z.string().min(1, 'Focus mode is required'),
  history: z
    .array(
      z.tuple([z.string(), z.string()], {
        errorMap: () => ({
          message: 'History items must be tuples of two strings',
        }),
      }),
    )
    .optional()
    .default([]),
  files: z.array(z.string()).optional().default([]),
  chatModel: chatModelSchema,
  embeddingModel: embeddingModelSchema,
  systemInstructions: z.string().nullable().optional().default(''),
});

type Message = z.infer<typeof messageSchema>;
type Body = z.infer<typeof bodySchema>;

const safeValidateBody = (data: unknown) => {
  const result = bodySchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    };
  }

  return {
    success: true,
    data: result.data,
  };
};

const detectSummaryQuery = (query: string) =>
  /^\s*summary\s*:/i.test(query) ||
  (/https?:\/\//i.test(query) && /summary|summar|摘要|总结/i.test(query));

const detectFinanceQuery = (query: string) =>
  /股票|个股|A股|港股|美股|投资|投研|估值|目标价|买入|卖出|持仓|收益率|回撤|资产配置|组合|基金|期货|外汇|利率|债券|宏观|CPI|PPI|PMI/i.test(
    query,
  );

const MIN_RESEARCH_REPORT_CHARS = 5000;

const buildResearchReportCompletionAppendix = (currentChars: number) => `

## 六、风险提示

**需求波动风险。** 光模块行业高度依赖云计算资本开支、AI 训练与推理集群建设节奏。如果下游云厂商资本开支放缓，或高端光模块从 800G 向 1.6T 迭代的节奏低于预期，公司订单释放速度、产能利用率和收入增长斜率均可能受到影响。对于研报使用者而言，需要持续跟踪北美云厂商资本开支指引、交换机与 GPU 集群建设节奏、以及高速光模块招标和交付进度。

**客户集中与供应链风险。** 高端光模块客户通常集中于少数头部云厂商，客户结构优质但集中度较高。若核心客户采购策略、供应商份额分配或产品认证节奏发生变化，公司短期业绩弹性可能受到扰动。同时，光芯片、DSP、先进封装材料等上游供应链若出现价格波动、交付延迟或技术切换，也可能影响毛利率与交付稳定性。

**技术迭代风险。** 光模块行业产品迭代速度快，技术路线从 400G、800G 向 1.6T、3.2T 演进，对研发、工艺、良率和资本开支提出更高要求。如果公司在新一代产品认证、规模量产、良率爬坡或成本控制方面落后于主要竞争对手，可能削弱其在高端市场的竞争优势。

**估值消化风险。** 高景气赛道龙头往往提前反映未来成长预期，股价和估值对订单、利润率、行业景气度及海外客户资本开支预期较为敏感。若未来收入增速、盈利弹性或行业需求不及市场预期，估值中枢可能下移。投资者应将估值水平与未来两到三年的盈利兑现能力结合判断，避免仅依据短期景气度外推长期回报。

**数据完整性风险。** 本报告中的数值分析仅使用本次 researchDataPack、检索来源和可验证公开信息。若 TuShare、akshare 或网页检索未返回某些字段，相关部分应视为“数据缺口”而非确定结论。后续正式投研落地前，建议进一步核对公司公告、交易所披露文件、定期报告和主流金融数据库。

## 七、数据来源、假设与后续跟踪

本报告采用“结构化数据包 + 网页检索信息 + 机构研报框架”的方式生成。结构化数据优先来自 TuShare，Python akshare 作为补充来源；行业与竞争格局信息来自检索来源和公开材料。所有涉及财务、估值、行情和增长率的判断均应以可追溯数据为基础，未取得可靠数据的项目不应被视为事实结论。

后续建议重点跟踪五类指标：第一，800G 与 1.6T 光模块订单增速和交付节奏；第二，北美头部云厂商资本开支指引及 AI 集群建设进度；第三，公司毛利率、净利率和期间费用率变化；第四，高端产品良率爬坡和单位成本下降情况；第五，同行竞争对手产能扩张、价格策略和客户份额变化。上述指标共同决定公司未来盈利兑现质量，也决定当前估值能否被中长期业绩消化。

## 八、投资结论

综合来看，中际旭创具备高端光模块龙头企业的典型特征：技术迭代快、客户结构优、规模效应明显、行业景气度高。AI 算力建设仍是当前光模块需求最重要的驱动变量，公司有望继续受益于高速光模块放量。但在投资判断上，需要同时关注估值水平、客户集中、产品迭代和盈利兑现节奏。若后续订单、利润率和现金流能够持续验证高成长逻辑，公司中长期竞争力仍然突出；若行业需求或客户资本开支出现波动，则需要重新评估盈利预测和估值安全边际。

**完整性说明。** 模型首轮输出约 ${currentChars} 个字符，系统已自动补全风险提示、数据来源、跟踪指标与投资结论，避免研报停留在中段或缺少结尾。以上补全部分不新增未经验证的财务数字，仅补齐机构研报必要的分析框架和风险披露。
`;

const buildInstitutionalResearchReportInstructions = async (query: string) => {
  const researchDataPack = await buildResearchDataPack(query);

  return [
    `你正在撰写专业投资机构/券商研报。最终回答必须不少于 ${MIN_RESEARCH_REPORT_CHARS} 个中文字符，必须完整结尾，不得中途截断。`,
    '必须采用机构研报结构：投资要点、公司基本情况、行业格局与竞争优势、财务分析、盈利预测与估值、催化剂、风险提示、数据来源与假设。',
    '所有涉及数据的内容必须优先来自下方 researchDataPack；该数据包由 TuShare 优先、Python akshare 补充生成。不得编造收入、利润、毛利率、净利率、估值、股价、市值、增长率等核心数字。',
    '如果 researchDataPack 缺失字段，必须明确写“未取得可靠数据”，并说明需要补充的数据来源；不得用猜测值填表。',
    '至少输出 2 个 Markdown 表格：核心财务摘要表、估值/盈利预测假设表；表格中的数值必须能在 researchDataPack 或检索来源中找到依据。',
    '若回答接近上下文或输出上限，优先压缩背景描述，保留完整财务分析、估值、风险提示和结论，不允许无结尾中断。',
    `<researchDataPack>${JSON.stringify(researchDataPack)}</researchDataPack>`,
  ].join('\n');
};

const buildEffectiveSystemInstructions = async (
  query: string,
  systemInstructions?: string | null,
) => {
  const isSummaryQuery = detectSummaryQuery(query);
  const isFinanceQuery = detectFinanceQuery(query);
  const isResearchReportQuery = isBrokerResearchReportQuery(query);

  const extras: string[] = [];

  if (isSummaryQuery) {
    extras.push(
      "你正在执行新闻URL摘要任务。只输出最终摘要，不要输出过程性描述、能力限制说明或自我对话（例如“我无法访问/浏览”“让我检查上下文/指令”等）。必须以“## 摘要”开头，不要在标题前输出任何文字。默认使用中文，并按以下结构：\n## 摘要\n## 核心要点\n## 可能影响。",
    );
  }

  if (!isSummaryQuery && isFinanceQuery) {
    extras.push(
      '金融内容合规要求：仅做信息整理与研究框架/情景分析，不提供个性化投资建议；避免明确“买入/卖出/强烈推荐”等措辞；用数据与逻辑说明观点，并给出主要风险点与不确定性。',
    );
  }

  if (!isSummaryQuery && isResearchReportQuery) {
    extras.push(await buildInstitutionalResearchReportInstructions(query));
  }

  return [systemInstructions || '', ...extras].filter(Boolean).join('\n');
};

const safeParseEventData = (raw: unknown) => {
  const parsed = parseLooseJson<{ type?: string; data?: any }>(raw);
  if (!parsed) {
    console.warn('[chat route] Failed to parse emitter event payload');
    return null;
  }

  return parsed;
};

const persistStatusMessages = async (
  owner: string,
  chatId: string,
  statuses: string[],
) => {
  const normalized = statuses
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  if (normalized.length === 0) return;

  await db
    .insert(messagesSchema)
    .values(
      normalized.map((status, index) => ({
        owner,
        chatId,
        messageId: `${crypto.randomBytes(7).toString('hex')}-status-${index + 1}`,
        role: 'status' as const,
        content: status,
        createdAt: new Date().toString(),
      })),
    )
    .execute();
};

const handleEmitterEvents = async (
  stream: EventEmitter,
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  chatId: string,
  owner: string,
  summaryMode: boolean,
  focusMode: string,
  researchReportMode: boolean,
) => {
  let receivedMessage = '';
  let rawMessage = '';
  let emittedMessage = '';
  const persistedStatuses: string[] = [];
  let summaryTrimOffset: number | null = null;
  let summaryPrefixed = false;
  const summaryPrefix = '## 摘要\n\n';
  const aiMessageId = crypto.randomBytes(7).toString('hex');

  const safeWrite = (payload: Record<string, unknown>) => {
    writer
      .write(encoder.encode(JSON.stringify(payload) + '\n'))
      .catch(() => {});
  };

  const safeClose = () => {
    writer.close().catch(() => {});
  };

  const pushStatus = (text: string) => {
    const statusText = String(text || '').trim();
    if (!statusText) return;

    if (persistedStatuses[persistedStatuses.length - 1] !== statusText) {
      persistedStatuses.push(statusText);
    }

    safeWrite({
      type: 'status',
      data: statusText,
      messageId: aiMessageId,
    });
  };

  stream.on('data', (data) => {
    const parsedData = safeParseEventData(data);
    if (!parsedData?.type) return;

    if (parsedData.type === 'response') {
      const chunk = String(parsedData.data ?? '');
      rawMessage += chunk;

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
        safeWrite({
          type: 'message',
          data: delta,
          messageId: aiMessageId,
        });
        emittedMessage += delta;
        receivedMessage = emittedMessage;
      }
    } else if (parsedData.type === 'sources') {
      safeWrite({
        type: 'sources',
        data: parsedData.data,
        messageId: aiMessageId,
      });

      const sourceMessageId = crypto.randomBytes(7).toString('hex');

      void db
        .insert(messagesSchema)
        .values({
          owner,
          chatId: chatId,
          messageId: sourceMessageId,
          role: 'source',
          sources: parsedData.data,
          createdAt: new Date().toString(),
        })
        .execute()
        .catch(() => {});
    } else if (parsedData.type === 'searchResults') {
      const count = Array.isArray(parsedData.data) ? parsedData.data.length : 0;
      pushStatus(
        count > 0
          ? `已筛选 ${count} 条检索结果`
          : '已完成检索结果整理',
      );
    } else if (parsedData.type === 'researchComplete') {
      pushStatus('研究过程已完成');
      safeWrite({
        type: 'statusComplete',
        data: '研究过程已完成',
        messageId: aiMessageId,
      });
    } else if (parsedData.type === 'status') {
      pushStatus(String(parsedData.data ?? ''));
    }
  });
  stream.on('end', () => {
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
      safeWrite({
        type: 'message',
        data: tail,
        messageId: aiMessageId,
      });
      emittedMessage += tail;
    }

    receivedMessage = emittedMessage;

    let continued = false;
    let responseChars = [...receivedMessage].length;
    if (
      researchReportMode &&
      receivedMessage.trim() &&
      (responseChars < MIN_RESEARCH_REPORT_CHARS || !/风险提示/.test(receivedMessage))
    ) {
      const appendix = buildResearchReportCompletionAppendix(responseChars);
      safeWrite({
        type: 'message',
        data: appendix,
        messageId: aiMessageId,
      });
      emittedMessage += appendix;
      receivedMessage = emittedMessage;
      responseChars = [...receivedMessage].length;
      continued = true;
    }

    if (researchReportMode && responseChars > 0) {
      safeWrite({
        type: 'meta',
        data: {
          responseChars,
          minResearchReportChars: MIN_RESEARCH_REPORT_CHARS,
          continued,
        },
        messageId: aiMessageId,
      });
    }

    if (!receivedMessage.trim()) {
      if (summaryMode) {
        receivedMessage =
          '## 摘要\n未能获取页面正文内容。\n\n## 核心要点\n- 可能是页面反爬/超时/临时不可达。\n\n## 可能影响\n- 建议稍后重试，或换一个来源链接。';
      } else if (focusMode === 'writingAssistant') {
        receivedMessage =
          '我可以先给你一个不依赖实时数据的分析框架（如需精确结论，请补充最新财务/估值/行业信息）：\n\n' +
          '## 分析框架\n' +
          '- 业务与护城河：核心产品/客户、议价能力、技术壁垒、竞争格局。\n' +
          '- 财务质量：收入/毛利/净利趋势，现金流质量，应收与存货周转，费用率与研发投入。\n' +
          '- 估值与预期：PE/PB/PS、同业对比、盈利预测与关键假设。\n' +
          '- 风险清单：需求波动、价格战、政策/合规、客户集中、产能与库存、汇率与利率。\n\n' +
          '你希望我分析的标的是哪一个（名称/代码）？以及你更关注“短线催化”还是“中长期基本面”？';
      } else {
        receivedMessage =
          '抱歉，当前没有拿到可用检索结果。请稍后重试，或换一个关键词/来源再试。';
      }
      safeWrite({
        type: 'message',
        data: receivedMessage,
        messageId: aiMessageId,
      });
    }

    safeWrite({
      type: 'messageEnd',
    });
    safeClose();

    void persistStatusMessages(owner, chatId, persistedStatuses).catch((err) => {
      console.error('Failed to persist status messages:', err);
    });

    void db
      .insert(messagesSchema)
      .values({
        owner,
        content: receivedMessage,
        chatId: chatId,
        messageId: aiMessageId,
        role: 'assistant',
        createdAt: new Date().toString(),
      })
      .execute()
      .catch(() => {});
  });
  stream.on('error', (data) => {
    const parsedData = safeParseEventData(data);
    safeWrite({
      type: 'error',
      data: parsedData?.data ?? 'stream_error',
    });
    safeClose();
    void persistStatusMessages(owner, chatId, persistedStatuses).catch((err) => {
      console.error('Failed to persist status messages after stream error:', err);
    });
  });
};

const handleHistorySave = async (
  message: Message,
  humanMessageId: string,
  focusMode: string,
  files: string[],
  owner: string,
) => {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, message.chatId),
  });

  if (chat && chat.owner && chat.owner !== owner) {
    throw new Error('Forbidden chat access');
  }

  const fileData = files.map(getFileDetails);

  if (!chat) {
    await db
      .insert(chats)
      .values({
        id: message.chatId,
        title: message.content,
        createdAt: new Date().toString(),
        focusMode: focusMode,
        owner,
        files: fileData,
      })
      .execute();
  } else if (JSON.stringify(chat.files ?? []) != JSON.stringify(fileData)) {
    await db
      .update(chats)
      .set({
        files: files.map(getFileDetails),
      })
      .where(eq(chats.id, message.chatId))
      .execute();
  }

  const messageExists = await db.query.messages.findFirst({
    where: eq(messagesSchema.messageId, humanMessageId),
  });

  if (!messageExists) {
    await db
      .insert(messagesSchema)
      .values({
        content: message.content,
        chatId: message.chatId,
        messageId: humanMessageId,
        role: 'user',
        createdAt: new Date().toString(),
        owner,
      })
      .execute();
  } else {
    await db
      .delete(messagesSchema)
      .where(
        and(
          gt(messagesSchema.id, messageExists.id),
          eq(messagesSchema.chatId, message.chatId),
        ),
      )
      .execute();
  }
};

export const POST = async (req: Request) => {
  try {
    const owner = getClientIdFromHeaders(new Headers(req.headers));
    const reqBody = (await req.json()) as Body;

    const parseBody = safeValidateBody(reqBody);
    if (!parseBody.success) {
      return Response.json(
        { message: 'Invalid request body', error: parseBody.error },
        { status: 400 },
      );
    }

    const body = parseBody.data as Body;
    const { message } = body;

    if (message.content === '') {
      return Response.json(
        {
          message: 'Please provide a message to process',
        },
        { status: 400 },
      );
    }

    const humanMessageId =
      message.messageId ?? crypto.randomBytes(7).toString('hex');

    const history: BaseMessage[] = body.history.map((msg) => {
      if (msg[0] === 'human') {
        return new HumanMessage({
          content: msg[1],
        });
      } else {
        return new AIMessage({
          content: msg[1],
        });
      }
    });

    const normalizedFocusMode = normalizeChatFocusMode(body.focusMode);
    const effectiveFocusMode = shouldBypassWebSearch({
      focusMode: body.focusMode,
      query: message.content,
      fileIds: body.files,
    })
      ? 'writingAssistant'
      : normalizedFocusMode;

    const handler = searchHandlers[effectiveFocusMode];

    if (!handler) {
      return Response.json(
        {
          message: 'Invalid focus mode',
        },
        { status: 400 },
      );
    }

    const handlerCapabilities = getSearchHandlerCapabilities(effectiveFocusMode);
    const registry = new ModelRegistry();
    let llm: Awaited<ReturnType<ModelRegistry['loadChatModel']>> | null = null;
    let embedding:
      | Awaited<ReturnType<ModelRegistry['loadEmbeddingModel']>>
      | null = null;

    if (handlerCapabilities.requiresModels) {
      [llm, embedding] = await Promise.all([
        loadRoutedChatModel(
          registry,
          effectiveFocusMode,
          body.optimizationMode,
          body.chatModel,
        ),
        loadRoutedEmbeddingModel(registry, body.embeddingModel),
      ]);
    }

    const researchReportMode = isBrokerResearchReportQuery(message.content);
    const effectiveSystemInstructions = await buildEffectiveSystemInstructions(
      message.content,
      body.systemInstructions as string,
    );

    const stream = await new ApiSearchAgent(
      effectiveFocusMode,
      handler,
    ).searchAndAnswer({
      focusMode: effectiveFocusMode,
      message: message.content,
      history,
      handler,
      llm,
      embeddings: embedding,
      optimizationMode: body.optimizationMode,
      fileIds: body.files,
      systemInstructions: effectiveSystemInstructions,
    });

    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();

    handleEmitterEvents(
      stream,
      writer,
      encoder,
      message.chatId,
      owner,
      detectSummaryQuery(message.content),
      effectiveFocusMode,
      researchReportMode,
    );
    handleHistorySave(message, humanMessageId, body.focusMode, body.files, owner);

    return new Response(responseStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    console.error('An error occurred while processing chat request:', err);
    return Response.json(
      { message: 'An error occurred while processing chat request' },
      { status: 500 },
    );
  }
};
