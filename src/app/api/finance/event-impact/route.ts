import fs from 'fs';
import path from 'node:path';
import ModelRegistry from '@/lib/models/registry';
import { getDailyChatModelSelection } from '@/lib/models/modelRouting';
import { parseLooseJson } from '@/lib/utils/json';
import { sanitizeLlmOutput } from '@/lib/utils/llmOutput';
import { recordCacheObservation } from '@/lib/cache/observability';
import {
  buildEventImpactMatrix,
  getEventImpactNewsStats,
  buildKeyEventInsights,
  EventImpactItem,
  formatEventImpactAsMarkdown,
  buildTargetImpactSummary,
  KeyEventInsight,
  TargetImpactSummary,
} from '@/lib/finance/eventImpact';
import {
  buildAssetAllocationView,
  buildTargetFundRecommendations,
  filterFundUniverseByCompany,
  getLocalFundUniverseWithMeta,
  mergeFundUniverse,
  type AllocationMarketView,
  type AssetAllocationView,
  type FundUniverseItem,
  type TargetFundRecommendation,
} from '@/lib/finance/fundAllocator';
import { callTushare, hasTushareToken } from '@/lib/economy/tushare';
import {
  getEventImpactFundPanelPromptTemplateConfig,
  getEventImpactMarketViewPromptTemplateConfig,
  getFundUniverseCompanyFilter,
} from '@/lib/config/serverRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventImpactCache = {
  version: number;
  slot: string;
  updatedAt: number;
  newsUpdatedAt: string;
  fundUniverseUpdatedAt: number;
  fundUniverseCount: number;
  fundUniverseScopeKey: string;
  matrix: EventImpactItem[];
  keyEvents: KeyEventInsight[];
  summary: TargetImpactSummary[];
  fundRecommendations: TargetFundRecommendation[];
  fundRecommendationPanel: TargetFundRecommendation[];
  assetAllocation: AssetAllocationView;
};

type AssetAllocationMeta = {
  mode: 'llm' | 'rule-fallback';
  providerId: string;
  model: string;
  reason: string;
};

type PromptMeta = {
  marketViewTemplateSource: 'env' | 'config' | 'default';
  fundPanelTemplateSource: 'env' | 'config' | 'default';
  marketViewTemplateCustomized: boolean;
  fundPanelTemplateCustomized: boolean;
};

type FundUniverseMeta = {
  localCount: number;
  dynamicCount: number;
  mergedCountBeforeFilter: number;
  totalCount: number;
  dynamicUpdatedAt: number;
  dynamicFromCache: boolean;
  localSourcePath: string;
  localSourceConfigured: boolean;
  companyFilterKeywords: string[];
  scopeKey: string;
  dynamicError?: string;
};

const TARGET_SCORE_TEMPLATE = {
  name: 'Target Composite Score v3 (All News + Top5)',
  formula:
    '综合分(0-100) = 100 × [0.50×全量新闻分 + 0.50×Top5关键事件分]；每部分内部 = 0.50×置信度 + 0.25×事件覆盖度 + 0.25×信号清晰度',
  weights: {
    allNews: 0.5,
    top5KeyEvents: 0.5,
  },
  notes: [
    '全量新闻分：使用全部新闻事件聚合，避免只看Top5导致样本偏差。',
    'Top5关键事件分：对归纳后的重点事件进行再加权，增强交易指向性。',
    '方向判定会在“利多/利空/分化”中做偏向修正，避免全部分化失去参考价值。',
  ],
};

const KEY_EVENT_SCORE_TEMPLATE = {
  name: 'Key Event Composite Score v2',
  formula:
    '重要度(0-100) = 100 × [0.40×事件强度 + 0.25×覆盖度 + 0.20×方向清晰度 + 0.15×时效性]',
  weights: {
    eventStrength: 0.4,
    coverage: 0.25,
    directionClarity: 0.2,
    recency: 0.15,
  },
  notes: [
    '事件强度由单篇事件的重要度与置信度聚合得到。',
    '覆盖度由新闻条数与来源多样性共同决定。',
    '最终只展示综合分最高的前 5 个事件原型，并附原文实例。',
  ],
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_PATH = path.join(DATA_DIR, 'data/event-impact-cache.json');
const NEWS_CACHE_PATH = path.join(DATA_DIR, 'data/news-cache.json');
const FUND_DYNAMIC_CACHE_PATH = path.join(DATA_DIR, 'data/fund/tushare-fund-universe-cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FUND_DYNAMIC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 17;
const SUMMARY_BLEND_WEIGHTS = {
  allNews: 0.5,
  top5KeyEvents: 0.5,
};

const pad = (n: number) => String(n).padStart(2, '0');
const getSixHourSlotLabel = (d: Date) => {
  const local = new Date(d.getTime());
  const slotHour = local.getHours() - (local.getHours() % 6);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(slotHour)}`;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const contentToText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const obj = part as { text?: unknown; type?: string };
          if (typeof obj.text === 'string') return obj.text;
          if (obj.type === 'text') return String(obj.text || '');
        }
        return '';
      })
      .join('');
  }
  return String(content || '');
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const pickDefaultChatModel = async (_registry: ModelRegistry) => {
  return getDailyChatModelSelection();
};

const fallbackMarketView = (summary: TargetImpactSummary[]): AllocationMarketView => {
  if (!summary.length) {
    return {
      outlook: '均衡',
      confidence: 0.55,
      marketView: '当前有效事件数量有限，建议保持均衡配置并等待新信号确认。',
      reasoning: '事件样本不足，采用保守中性观点。',
      llmGenerated: false,
      error: 'empty summary',
    };
  }

  let positive = 0;
  let mixed = 0;
  let negative = 0;
  let confidenceSum = 0;

  summary.forEach((r) => {
    if (r.direction === 'positive') positive += r.totalWeight;
    else if (r.direction === 'negative') negative += r.totalWeight;
    else mixed += r.totalWeight;
    confidenceSum += r.confidence;
  });

  const total = positive + mixed + negative;
  const sentiment = total > 0 ? (positive - negative) / total : 0;
  const avgConfidence = confidenceSum / Math.max(1, summary.length);

  const outlook: '偏进攻' | '均衡' | '偏防守' =
    sentiment >= 0.16 ? '偏进攻' : sentiment <= -0.08 ? '偏防守' : '均衡';

  const marketView =
    outlook === '偏进攻'
      ? '事件矩阵显示利多方向占优，市场风险偏好改善，可适度提高权益与主题资产权重。'
      : outlook === '偏防守'
        ? '事件矩阵显示利空压力偏强，建议以固收和避险资产为主，控制高波动仓位。'
        : '事件矩阵信号分化，建议维持均衡配置，通过多资产对冲提升回撤控制能力。';

  return {
    outlook,
    confidence: clamp(0.45 + avgConfidence * 0.5, 0.45, 0.9),
    marketView,
    reasoning: `规则回退：正向权重 ${positive.toFixed(2)}，负向权重 ${negative.toFixed(2)}，分化权重 ${mixed.toFixed(2)}。`,
    llmGenerated: false,
  };
};

const buildMarketViewPrompt = (summary: TargetImpactSummary[]) => {
  const topRows = summary.slice(0, 16).map((r) => ({
    target: r.target,
    direction: r.direction,
    confidence: Number(r.confidence.toFixed(2)),
    eventCount: r.eventCount,
    weight: Number(r.totalWeight.toFixed(2)),
  }));

  const defaultTemplate = [
    '你是中国多资产配置研究员。',
    '请基于以下事件-标的汇总，输出资产配置市场观点。',
    '',
    '仅输出 JSON，不要输出 markdown 或解释。',
    'JSON schema:',
    '{',
    '  "outlook": "偏进攻|均衡|偏防守",',
    '  "confidence": 0.0-1.0,',
    '  "marketView": "一句话市场观点（中文）",',
    '  "reasoning": "2-3句中文，说明触发该观点的关键事件结构"',
    '}',
    '',
    '输入数据:',
    '{{summary_json}}',
  ].join('\n');

  const configuredTemplate = getEventImpactMarketViewPromptTemplateConfig();
  const template = configuredTemplate.value || defaultTemplate;
  const rendered = template.replace(/\{\{\s*summary_json\s*\}\}/g, JSON.stringify(topRows, null, 2));
  if (/\{\{\s*summary_json\s*\}\}/.test(template)) return rendered;
  return `${rendered}\n\n输入数据:\n${JSON.stringify(topRows, null, 2)}`;
};

const runLlmMarketView = async (
  summary: TargetImpactSummary[],
): Promise<AllocationMarketView> => {
  const fallback = fallbackMarketView(summary);

  try {
    const registry = new ModelRegistry();
    const chatModel = await pickDefaultChatModel(registry);
    if (!chatModel) {
      return {
        ...fallback,
        error: 'missing chat model',
      };
    }

    const llm = await registry.loadChatModel(chatModel.providerId, chatModel.key);
    const prompt = buildMarketViewPrompt(summary);
    const res = await withTimeout(llm.invoke(prompt), 40_000);

    const raw = contentToText((res as any)?.content ?? '');
    const cleaned = sanitizeLlmOutput(raw);
    const parsed =
      parseLooseJson<{
        outlook?: string;
        confidence?: number;
        marketView?: string;
        reasoning?: string;
      }>(cleaned) ||
      parseLooseJson<{
        outlook?: string;
        confidence?: number;
        marketView?: string;
        reasoning?: string;
      }>(raw);

    if (!parsed) {
      return {
        ...fallback,
        error: 'llm parse failed',
        providerId: chatModel.providerId,
        model: chatModel.key,
      };
    }

    const outlookRaw = String(parsed.outlook || '').trim();
    const outlook: '偏进攻' | '均衡' | '偏防守' =
      outlookRaw === '偏进攻' || outlookRaw === '偏防守' || outlookRaw === '均衡'
        ? outlookRaw
        : fallback.outlook;

    return {
      outlook,
      confidence: clamp(Number(parsed.confidence ?? fallback.confidence), 0.4, 0.95),
      marketView:
        String(parsed.marketView || '').trim() ||
        fallback.marketView,
      reasoning:
        String(parsed.reasoning || '').trim() ||
        fallback.reasoning,
      llmGenerated: true,
      providerId: chatModel.providerId,
      model: chatModel.key,
    };
  } catch (err: any) {
    return {
      ...fallback,
      error: err?.message || 'llm failed',
    };
  }
};

const buildFundPanelPrompt = (rows: TargetFundRecommendation[]) => {
  const payload = rows.map((row) => ({
    target: row.target,
    direction: row.direction,
    confidence: Number(row.confidence.toFixed(2)),
    eventCount: row.eventCount,
    riskHint: row.riskHint,
    funds: row.funds.map((f) => ({
      tsCode: f.tsCode,
      name: f.name,
      category: f.category,
      style: f.style,
      riskLevel: f.riskLevel,
      reason: f.reason,
      riskPrompt: f.riskPrompt,
    })),
  }));

  const defaultTemplate = [
    '你是中国公募基金配置研究员。',
    '请根据每个概念的方向与候选基金信息，筛选最匹配基金。',
    '要求：',
    '1) 每个概念最多选择2只基金',
    '2) 方向为positive时，优先选择与概念匹配度高、逻辑一致的基金',
    '3) 方向为negative时，优先给出防守/对冲逻辑，不要选明显高贝塔错配基金',
    '4) 必须核对概念与基金匹配度，至少命中“行业/风格/策略”之一，不匹配则不要选择',
    '5) 如果候选都不匹配，可返回空数组',
    '',
    '仅输出 JSON，schema:',
    '{ "rows": [ { "target": "string", "selectedTsCodes": ["string"], "panelNote": "string" } ] }',
    '',
    '输入数据:',
    '{{rows_json}}',
  ].join('\n');

  const configuredTemplate = getEventImpactFundPanelPromptTemplateConfig();
  const template = configuredTemplate.value || defaultTemplate;
  const rendered = template.replace(/\{\{\s*rows_json\s*\}\}/g, JSON.stringify(payload, null, 2));
  if (/\{\{\s*rows_json\s*\}\}/.test(template)) return rendered;
  return `${rendered}\n\n输入数据:\n${JSON.stringify(payload, null, 2)}`;
};

const resolvePromptMeta = (): PromptMeta => {
  const marketPrompt = getEventImpactMarketViewPromptTemplateConfig();
  const fundPanelPrompt = getEventImpactFundPanelPromptTemplateConfig();

  return {
    marketViewTemplateSource: marketPrompt.source,
    fundPanelTemplateSource: fundPanelPrompt.source,
    marketViewTemplateCustomized: Boolean(marketPrompt.value),
    fundPanelTemplateCustomized: Boolean(fundPanelPrompt.value),
  };
};

const runLlmFundPanelRefiner = async (rows: TargetFundRecommendation[]) => {
  const picked = new Map<string, { selectedTsCodes: string[]; panelNote: string }>();
  if (!rows.length) return picked;

  try {
    const registry = new ModelRegistry();
    const chatModel = await pickDefaultChatModel(registry);
    if (!chatModel) return picked;

    const llm = await registry.loadChatModel(chatModel.providerId, chatModel.key);
    const prompt = buildFundPanelPrompt(rows);
    const res = await withTimeout(llm.invoke(prompt), 45_000);
    const raw = contentToText((res as any)?.content ?? '');
    const cleaned = sanitizeLlmOutput(raw);

    const parsed =
      parseLooseJson<{
        rows?: Array<{
          target?: string;
          selectedTsCodes?: string[];
          panelNote?: string;
        }>;
      }>(cleaned) ||
      parseLooseJson<{
        rows?: Array<{
          target?: string;
          selectedTsCodes?: string[];
          panelNote?: string;
        }>;
      }>(raw);

    const rowsOut = Array.isArray(parsed?.rows) ? parsed!.rows : [];
    for (const row of rowsOut) {
      const target = String(row?.target || '').trim();
      if (!target) continue;
      const selectedTsCodes = Array.isArray(row?.selectedTsCodes)
        ? row!.selectedTsCodes
            .map((x) => String(x || '').trim().toUpperCase())
            .filter(Boolean)
            .slice(0, 2)
        : [];
      const panelNote = String(row?.panelNote || '').trim();
      picked.set(target, { selectedTsCodes, panelNote });
    }
  } catch (err) {
    console.warn('LLM fund panel refine failed, fallback to rule-based selection', err);
  }

  return picked;
};

const buildPanelTargetTerms = (target: string) => {
  const base = normalize(target);
  const parts = base
    .split(/[、,，\-\/\s]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
  return Array.from(new Set([base, ...parts])).slice(0, 8);
};

const isFundAlignedForTarget = (
  target: string,
  fund: { name?: string; style?: string; category?: string; reason?: string; riskPrompt?: string },
) => {
  const terms = buildPanelTargetTerms(target);
  if (!terms.length) return false;
  const hay = normalize(
    `${fund.name || ''} ${fund.style || ''} ${fund.category || ''} ${fund.reason || ''} ${fund.riskPrompt || ''}`,
  );
  if (!hay) return false;
  return terms.some((term) => term && hay.includes(term));
};

const buildFundRecommendationPanel = async (
  summaryRows: TargetImpactSummary[],
  recommendations: TargetFundRecommendation[],
  opts?: {
    maxConcepts?: number;
    maxFundsPerConcept?: number;
    useLlm?: boolean;
  },
): Promise<TargetFundRecommendation[]> => {
  const maxConcepts = Math.max(1, Math.min(12, opts?.maxConcepts ?? 10));
  const maxFunds = Math.max(1, Math.min(2, opts?.maxFundsPerConcept ?? 2));
  const useLlm = opts?.useLlm ?? false;

  const recMap = new Map<string, TargetFundRecommendation>();
  recommendations.forEach((row) => recMap.set(normalize(row.target), row));

  const candidates: TargetFundRecommendation[] = [];
  for (const s of summaryRows) {
    const actionableDirection = resolveActionableDirection(
      s.positiveWeight,
      s.mixedWeight,
      s.negativeWeight,
    );
    if (actionableDirection === 'mixed') continue;
    const rec = recMap.get(normalize(s.target));
    if (!rec || !Array.isArray(rec.funds) || rec.funds.length === 0) continue;
    const alignedFunds = rec.funds.filter((f) => isFundAlignedForTarget(s.target, f));
    if (!alignedFunds.length) continue;
    candidates.push({
      ...rec,
      direction: actionableDirection,
      confidence: s.confidence,
      eventCount: s.eventCount,
      funds: alignedFunds.slice(0, 4),
    });
    if (candidates.length >= maxConcepts) break;
  }

  if (!candidates.length) {
    const fallbackCandidates = summaryRows
      .map((s) => ({
        summary: s,
        direction: resolveActionableDirection(s.positiveWeight, s.mixedWeight, s.negativeWeight),
      }))
      .filter((x) => x.direction !== 'mixed')
      .slice(0, maxConcepts)
      .map(({ summary, direction }) => {
        const rec = recMap.get(normalize(summary.target));
        if (!rec || !Array.isArray(rec.funds) || rec.funds.length === 0) return null;
        const alignedFunds = rec.funds.filter((f) =>
          isFundAlignedForTarget(summary.target, f),
        );
        if (!alignedFunds.length) return null;
        return {
          ...rec,
          direction,
          confidence: summary.confidence,
          eventCount: summary.eventCount,
          funds: alignedFunds.slice(0, maxFunds),
        } satisfies TargetFundRecommendation;
      })
      .filter((x): x is TargetFundRecommendation => Boolean(x));

    if (fallbackCandidates.length) {
      return fallbackCandidates;
    }

    // Emergency fallback: keep panel non-empty for actionable concepts.
    const emergency = summaryRows
      .map((s) => ({
        summary: s,
        direction: resolveActionableDirection(
          s.positiveWeight,
          s.mixedWeight,
          s.negativeWeight,
        ),
      }))
      .filter((x) => x.direction !== 'mixed')
      .slice(0, maxConcepts)
      .map(({ summary, direction }) => {
        const rec = recMap.get(normalize(summary.target));
        if (!rec || !Array.isArray(rec.funds) || rec.funds.length === 0) return null;
        return {
          ...rec,
          direction,
          confidence: summary.confidence,
          eventCount: summary.eventCount,
          funds: rec.funds.slice(0, maxFunds),
        } satisfies TargetFundRecommendation;
      })
      .filter((x): x is TargetFundRecommendation => Boolean(x));

    if (emergency.length) {
      return emergency;
    }

    return recommendations
      .filter((x) => x.direction === 'positive' || x.direction === 'negative')
      .slice(0, maxConcepts)
      .map((x) => ({
        ...x,
        funds: x.funds.slice(0, maxFunds),
      }));
  }
  if (!useLlm) {
    return candidates.map((row) => ({
      ...row,
      funds: row.funds.slice(0, maxFunds),
    }));
  }

  const llmPicks = await runLlmFundPanelRefiner(candidates);
  return candidates.map((row) => {
    const picked = llmPicks.get(row.target);
    const selectedCodes = picked?.selectedTsCodes || [];
    const selectedFunds = selectedCodes.length
      ? row.funds.filter((f) => selectedCodes.includes(String(f.tsCode).toUpperCase()))
      : [];
    const funds = (selectedFunds.length ? selectedFunds : row.funds).slice(0, maxFunds);
    const panelNote = picked?.panelNote;

    return {
      ...row,
      riskHint: panelNote ? `${row.riskHint}；${panelNote}` : row.riskHint,
      funds,
    };
  });
};

const loadCache = (): EventImpactCache | null => {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as EventImpactCache;
    if (
      !parsed ||
      parsed.version !== CACHE_SCHEMA_VERSION ||
      typeof parsed.slot !== 'string' ||
      typeof parsed.updatedAt !== 'number' ||
      typeof parsed.fundUniverseUpdatedAt !== 'number' ||
      typeof parsed.fundUniverseCount !== 'number' ||
      typeof parsed.fundUniverseScopeKey !== 'string' ||
      !Array.isArray(parsed.matrix) ||
      !Array.isArray(parsed.keyEvents) ||
      !Array.isArray(parsed.summary) ||
      !Array.isArray(parsed.fundRecommendations) ||
      !Array.isArray(parsed.fundRecommendationPanel) ||
      !parsed.assetAllocation
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const toAssetAllocationMeta = (
  allocation: AssetAllocationView,
): AssetAllocationMeta => ({
  mode: allocation.llmGenerated ? 'llm' : 'rule-fallback',
  providerId: String(allocation.providerId || ''),
  model: String(allocation.model || ''),
  reason: String(allocation.error || ''),
});

const saveCache = (cache: EventImpactCache) => {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write event-impact cache', err);
  }
};

const getNewsUpdatedAt = () => {
  try {
    if (!fs.existsSync(NEWS_CACHE_PATH)) return '';
    const raw = fs.readFileSync(NEWS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { updatedAt?: string };
    return String(parsed?.updatedAt || '');
  } catch {
    return '';
  }
};

const warmFinanceNewsCache = async (reqUrl: string) => {
  try {
    const url = new URL('/api/news/finance', reqUrl).toString();
    await withTimeout(
      fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then(() => undefined),
      12_000,
    );
  } catch (err) {
    console.warn('Failed to warm /api/news/finance before event-impact', err);
  }
};

type TushareFundCachePayload = {
  updatedAt: number;
  items: FundUniverseItem[];
  error?: string;
};

const inferRiskLevelByFundType = (fundType: string) => {
  const t = String(fundType || '');
  if (/货币|现金|短融/.test(t)) return 'R1-低风险';
  if (/债|固收|中短债|国债/.test(t)) return 'R2-中低风险';
  if (/混合|fof/i.test(t)) return 'R3-中风险';
  if (/股票|指数|etf|qdii|黄金|商品|lof/i.test(t)) return 'R4-中高风险';
  return 'R3-中风险';
};

const loadTushareFundCache = (): TushareFundCachePayload | null => {
  try {
    if (!fs.existsSync(FUND_DYNAMIC_CACHE_PATH)) return null;
    const raw = fs.readFileSync(FUND_DYNAMIC_CACHE_PATH, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as TushareFundCachePayload;
    if (!parsed || typeof parsed.updatedAt !== 'number' || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const saveTushareFundCache = (payload: TushareFundCachePayload) => {
  try {
    const dir = path.dirname(FUND_DYNAMIC_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FUND_DYNAMIC_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write tushare fund cache', err);
  }
};

const fetchTushareFundUniverse = async (): Promise<{
  items: FundUniverseItem[];
  updatedAt: number;
  fromCache: boolean;
  error?: string;
}> => {
  if (!hasTushareToken()) {
    return { items: [], updatedAt: 0, fromCache: false };
  }

  const cached = loadTushareFundCache();
  if (cached && Date.now() - cached.updatedAt < FUND_DYNAMIC_CACHE_TTL_MS) {
    return {
      items: cached.items,
      updatedAt: cached.updatedAt,
      fromCache: true,
      error: cached.error || '',
    };
  }

  try {
    const rows = await callTushare(
      'fund_basic',
      { status: 'L' },
      [
        'ts_code',
        'name',
        'management',
        'fund_type',
        'invest_type',
        'type',
        'market',
        'status',
        'found_date',
        'list_date',
      ],
    );

    const mapped: FundUniverseItem[] = rows
      .map((r) => {
        const tsCode = String(r.ts_code || '').trim().toUpperCase();
        const name = String(r.name || '').trim();
        const fundType = String(r.fund_type || r.invest_type || r.type || '基金').trim();
        const management = String(r.management || '').trim();
        const market = String(r.market || '').trim();
        const setupDate = String(r.list_date || r.found_date || '').trim();
        if (!tsCode || !name) return null;

        return {
          tsCode,
          name,
          secName: name,
          category: `TuShare-${market || '基金'}`,
          manager: '',
          ret6m: null,
          ret1y: null,
          scaleYi: null,
          style: fundType,
          firstType: fundType,
          riskLevel: inferRiskLevelByFundType(fundType),
          intro: `TuShare 动态基金池，管理人：${management || '-'}`,
          majorIndustries: '',
          industryDate: '',
          setupDate,
          company: management,
        } as FundUniverseItem;
      })
      .filter((x): x is FundUniverseItem => Boolean(x));

    const payload: TushareFundCachePayload = {
      updatedAt: Date.now(),
      items: mapped,
      error: '',
    };
    saveTushareFundCache(payload);
    return {
      items: mapped,
      updatedAt: payload.updatedAt,
      fromCache: false,
      error: '',
    };
  } catch (err: any) {
    console.error('Failed to fetch fund universe from tushare', err);
    const errorText = String(err?.message || 'tushare unavailable');
    // Cache failed state too, avoiding repeated high-latency retries.
    saveTushareFundCache({
      updatedAt: Date.now(),
      items: cached?.items || [],
      error: errorText,
    });
    if (cached) {
      return {
        items: cached.items,
        updatedAt: cached.updatedAt,
        fromCache: true,
        error: errorText,
      };
    }
    return { items: [], updatedAt: Date.now(), fromCache: false, error: errorText };
  }
};

const loadMergedFundUniverse = async (): Promise<{
  fundUniverse: FundUniverseItem[];
  meta: FundUniverseMeta;
}> => {
  const local = getLocalFundUniverseWithMeta();
  const companyFilterKeywords = getFundUniverseCompanyFilter();
  const dynamic = await fetchTushareFundUniverse();
  const merged = mergeFundUniverse(local.items, dynamic.items);
  const filtered = filterFundUniverseByCompany(merged, companyFilterKeywords);
  const scopeKey = [
    local.sourcePath || '-',
    local.configuredPath || '-',
    companyFilterKeywords.join('|') || '-',
  ].join('::');

  return {
    fundUniverse: filtered,
    meta: {
      localCount: local.items.length,
      dynamicCount: dynamic.items.length,
      mergedCountBeforeFilter: merged.length,
      totalCount: filtered.length,
      dynamicUpdatedAt: dynamic.updatedAt,
      dynamicFromCache: dynamic.fromCache,
      localSourcePath: local.sourcePath,
      localSourceConfigured: local.configured,
      companyFilterKeywords,
      scopeKey,
      dynamicError: dynamic.error || '',
    },
  };
};

const normalize = (v: string) =>
  (v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const filterRowsByQuery = (rows: EventImpactItem[], query: string) => {
  const q = normalize(query);
  let out = rows;
  if (q) {
    out = rows.filter((row) => {
      const hay = normalize(
        `${row.event} ${row.sectors.join(' ')} ${row.assets.join(' ')} ${row.source} ${row.matchedKeywords.join(' ')}`,
      );
      return hay.includes(q);
    });
  }
  return out;
};

const buildSupplementEventsFromSummary = (
  summary: TargetImpactSummary[],
  needCount: number,
): EventImpactItem[] => {
  if (needCount <= 0) return [];

  return summary.slice(0, needCount).map((s, idx) => ({
    event: `聚合信号：${s.target}`,
    source: 'aggregated',
    sourceUrl: '',
    timestamp: '',
    sectors: [s.target],
    assets: [],
    direction: s.direction,
    confidence: Number(s.confidence.toFixed(2)),
    importanceScore: Number(
      clamp(s.confidence * 0.82 + Math.min(0.16, s.eventCount * 0.03), 0.45, 0.95).toFixed(2),
    ),
    rationale: `基于 ${s.eventCount} 条事件汇总，综合分 ${s.compositeScore.toFixed(1)}。`,
    matchedKeywords: ['聚合补齐', `rank-${idx + 1}`],
  }));
};

const resolveActionableDirection = (
  positiveWeight: number,
  mixedWeight: number,
  negativeWeight: number,
): 'positive' | 'mixed' | 'negative' => {
  const total = positiveWeight + mixedWeight + negativeWeight;
  if (total <= 0) return 'mixed';

  const posShare = positiveWeight / total;
  const negShare = negativeWeight / total;
  const mixShare = mixedWeight / total;
  const net = posShare - negShare;

  if (net >= 0.05 || (mixShare < 0.58 && posShare > negShare)) return 'positive';
  if (net <= -0.05 || (mixShare < 0.58 && negShare > posShare)) return 'negative';
  return 'mixed';
};

const buildSummaryFromKeyEvents = (keyEvents: KeyEventInsight[]) => {
  if (!keyEvents.length) return [] as TargetImpactSummary[];
  const pseudoRows: EventImpactItem[] = [];

  keyEvents.forEach((event) => {
    const direction: EventImpactItem['direction'] =
      event.direction === 'neutral' ? 'mixed' : event.direction;
    const eventConfidence = clamp(event.confidence, 0.45, 0.95);
    const eventImportance = clamp(event.compositeScore / 100, 0.45, 0.99);
    const firstExample = event.examples?.[0];

    event.targets.slice(0, 8).forEach((target) => {
      pseudoRows.push({
        event: event.title,
        source: firstExample?.source || 'key-event',
        sourceUrl: firstExample?.sourceUrl || '',
        timestamp: firstExample?.timestamp || '',
        sectors: [target],
        assets: [],
        direction,
        confidence: Number(eventConfidence.toFixed(2)),
        importanceScore: Number(eventImportance.toFixed(2)),
        rationale: event.rationale,
        matchedKeywords: [event.themeKey],
      });
    });
  });

  return buildTargetImpactSummary(pseudoRows);
};

const blendTargetSummaries = (
  allNewsSummary: TargetImpactSummary[],
  keyEventSummary: TargetImpactSummary[],
) => {
  if (!allNewsSummary.length) return keyEventSummary;
  if (!keyEventSummary.length) return allNewsSummary;

  const norm = (v: string) =>
    (v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const keyMap = new Map<string, TargetImpactSummary>();
  keyEventSummary.forEach((row) => keyMap.set(norm(row.target), row));
  const allMap = new Map<string, TargetImpactSummary>();
  allNewsSummary.forEach((row) => allMap.set(norm(row.target), row));

  const mergedKeys = new Set<string>([...allMap.keys(), ...keyMap.keys()]);
  const out: TargetImpactSummary[] = [];

  for (const key of mergedKeys) {
    const allRow = allMap.get(key);
    const keyRow = keyMap.get(key);
    const name = allRow?.target || keyRow?.target || '';
    if (!name) continue;

    const allWeight = SUMMARY_BLEND_WEIGHTS.allNews;
    const keyWeight = SUMMARY_BLEND_WEIGHTS.top5KeyEvents;

    const positiveWeight =
      (allRow?.positiveWeight || 0) * allWeight + (keyRow?.positiveWeight || 0) * keyWeight;
    const mixedWeight =
      (allRow?.mixedWeight || 0) * allWeight + (keyRow?.mixedWeight || 0) * keyWeight;
    const negativeWeight =
      (allRow?.negativeWeight || 0) * allWeight + (keyRow?.negativeWeight || 0) * keyWeight;

    const totalWeight = positiveWeight + mixedWeight + negativeWeight;
    if (totalWeight <= 0) continue;

    const confidenceScore =
      ((allRow?.scoreBreakdown.confidence || 0) / 100) * allWeight +
      ((keyRow?.scoreBreakdown.confidence || 0) / 100) * keyWeight;
    const coverageScore =
      ((allRow?.scoreBreakdown.eventCoverage || 0) / 100) * allWeight +
      ((keyRow?.scoreBreakdown.eventCoverage || 0) / 100) * keyWeight;
    const clarityScore =
      ((allRow?.scoreBreakdown.signalClarity || 0) / 100) * allWeight +
      ((keyRow?.scoreBreakdown.signalClarity || 0) / 100) * keyWeight;

    const direction = resolveActionableDirection(positiveWeight, mixedWeight, negativeWeight);
    const netBias = Math.abs((positiveWeight - negativeWeight) / totalWeight);
    const decisiveBoost = Math.min(0.06, netBias * 0.16);
    const confidence = clamp(confidenceScore + decisiveBoost, 0.45, 0.95);
    const compositeScore = clamp(
      confidence * 0.5 + coverageScore * 0.25 + clarityScore * 0.25 + decisiveBoost * 0.5,
      0.45,
      0.99,
    );

    out.push({
      target: name,
      positiveWeight: Number(positiveWeight.toFixed(2)),
      mixedWeight: Number(mixedWeight.toFixed(2)),
      negativeWeight: Number(negativeWeight.toFixed(2)),
      direction,
      confidence: Number(confidence.toFixed(2)),
      eventCount: Math.max(
        allRow?.eventCount || 0,
        Math.round(((allRow?.eventCount || 0) * 0.7 + (keyRow?.eventCount || 0) * 0.3)),
      ),
      totalWeight: Number(totalWeight.toFixed(2)),
      compositeScore: Number((compositeScore * 100).toFixed(1)),
      scoreBreakdown: {
        confidence: Number((confidenceScore * 100).toFixed(1)),
        eventCoverage: Number((coverageScore * 100).toFixed(1)),
        signalClarity: Number((clarityScore * 100).toFixed(1)),
      },
    });
  }

  out.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.totalWeight !== a.totalWeight) return b.totalWeight - a.totalWeight;
    return a.target.localeCompare(b.target, 'zh-CN');
  });

  return out;
};

export const GET = async (req: Request) => {
  try {
    const requestStart = Date.now();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const limitRaw = Number(searchParams.get('limit') || 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, limitRaw))
      : 20;

    const slotLabel = getSixHourSlotLabel(new Date());
    const promptMeta = resolvePromptMeta();
    const cached = loadCache();
    if (!cached || cached.slot !== slotLabel) {
      await warmFinanceNewsCache(req.url);
    }

    const newsUpdatedAt = getNewsUpdatedAt();
    const { fundUniverse, meta: fundUniverseMeta } = await loadMergedFundUniverse();

    let fullMatrix: EventImpactItem[] = [];
    let fullKeyEvents: KeyEventInsight[] = [];
    let fullAllNewsSummary: TargetImpactSummary[] = [];
    let fullKeyEventSummary: TargetImpactSummary[] = [];
    let fullSummary: TargetImpactSummary[] = [];
    let fullFundRecommendations: TargetFundRecommendation[] = [];
    let fullFundRecommendationPanel: TargetFundRecommendation[] = [];
    let fullAssetAllocation: AssetAllocationView = buildAssetAllocationView([], []);

    let fromCache = false;

    const cacheFresh =
      cached &&
      cached.slot === slotLabel &&
      Date.now() - cached.updatedAt < CACHE_TTL_MS &&
      cached.newsUpdatedAt === newsUpdatedAt &&
      cached.fundUniverseUpdatedAt === fundUniverseMeta.dynamicUpdatedAt &&
      cached.fundUniverseCount === fundUniverse.length &&
      cached.fundUniverseScopeKey === fundUniverseMeta.scopeKey &&
      cached.matrix.length > 0;

    const cachedKeyEventsValid =
      Array.isArray(cached?.keyEvents) &&
      cached!.keyEvents.length > 0 &&
      cached!.keyEvents.length <= 5 &&
      cached!.keyEvents.every(
        (x) =>
          typeof x?.compositeScore === 'number' &&
          Array.isArray(x?.examples) &&
          x.examples.length > 0 &&
          (x as any)?.scoreBreakdown,
      );

    if (cacheFresh && cachedKeyEventsValid) {
      fullMatrix = cached.matrix;
      fullKeyEvents = cached.keyEvents;
      fullAllNewsSummary = buildTargetImpactSummary(fullMatrix);
      fullKeyEventSummary = buildSummaryFromKeyEvents(fullKeyEvents);
      fullSummary = cached.summary;
      fullFundRecommendations = cached.fundRecommendations;
      fullFundRecommendationPanel = cached.fundRecommendationPanel;
      fullAssetAllocation = cached.assetAllocation;
      fromCache = true;
    } else {
      fullMatrix = buildEventImpactMatrix({ limit: 1200 });
      fullKeyEvents = buildKeyEventInsights(fullMatrix, { limit: 5 });
      fullAllNewsSummary = buildTargetImpactSummary(fullMatrix);
      fullKeyEventSummary = buildSummaryFromKeyEvents(fullKeyEvents);
      fullSummary = blendTargetSummaries(fullAllNewsSummary, fullKeyEventSummary);
      fullFundRecommendations = buildTargetFundRecommendations(fullSummary, {
        topTargets: 24,
        topFundsPerTarget: 3,
        fundUniverse,
      });
      fullFundRecommendationPanel = await buildFundRecommendationPanel(
        fullSummary,
        fullFundRecommendations,
        {
          maxConcepts: 10,
          maxFundsPerConcept: 2,
          useLlm: true,
        },
      );

      const llmView = await runLlmMarketView(fullSummary);
      fullAssetAllocation = buildAssetAllocationView(
        fullSummary,
        fullFundRecommendations,
        llmView,
        fundUniverse,
      );

      saveCache({
        version: CACHE_SCHEMA_VERSION,
        slot: slotLabel,
        updatedAt: Date.now(),
        newsUpdatedAt,
        fundUniverseUpdatedAt: fundUniverseMeta.dynamicUpdatedAt,
        fundUniverseCount: fundUniverse.length,
        fundUniverseScopeKey: fundUniverseMeta.scopeKey,
        matrix: fullMatrix,
        keyEvents: fullKeyEvents,
        summary: fullSummary,
        fundRecommendations: fullFundRecommendations,
        fundRecommendationPanel: fullFundRecommendationPanel,
        assetAllocation: fullAssetAllocation,
      });
    }

    const newsStats = getEventImpactNewsStats();

    const filtered = filterRowsByQuery(fullMatrix, query);
    const keyEvents = query.trim()
      ? buildKeyEventInsights(filtered, { limit: 5 })
      : fullKeyEvents;
    const summary = query.trim()
      ? blendTargetSummaries(
          buildTargetImpactSummary(filtered),
          buildSummaryFromKeyEvents(keyEvents),
        )
      : fullSummary;

    const eventListLimit = query.trim()
      ? limit
      : Math.max(5, Math.min(10, limit));
    const baseMatrix = filtered.slice(0, eventListLimit);
    const supplementCount = Math.max(0, 5 - baseMatrix.length);
    const supplements = query.trim()
      ? []
      : buildSupplementEventsFromSummary(summary, supplementCount);
    const matrix = [...baseMatrix, ...supplements].slice(0, eventListLimit);
    const fundRecommendations =
      query.trim()
        ? buildTargetFundRecommendations(summary, {
            topTargets: 24,
            topFundsPerTarget: 3,
            fundUniverse,
          })
        : fullFundRecommendations;
    const fundRecommendationPanel = query.trim()
      ? await buildFundRecommendationPanel(summary, fundRecommendations, {
          maxConcepts: 10,
          maxFundsPerConcept: 2,
          useLlm: false,
        })
      : fullFundRecommendationPanel;

    const assetAllocation =
      query.trim()
        ? buildAssetAllocationView(summary, fundRecommendations, {
            outlook: fullAssetAllocation.outlook,
            confidence: fullAssetAllocation.confidence,
            marketView: `${fullAssetAllocation.marketView}（当前按筛选条件重算基金组合）`,
            reasoning: fullAssetAllocation.reasoning,
            llmGenerated: fullAssetAllocation.llmGenerated,
            providerId: fullAssetAllocation.providerId,
            model: fullAssetAllocation.model,
            error: fullAssetAllocation.error,
          }, fundUniverse)
        : fullAssetAllocation;
    const assetAllocationMeta = toAssetAllocationMeta(assetAllocation);

    recordCacheObservation({
      module: 'event_impact',
      slot: slotLabel,
      cached: fromCache,
      sampleSize: fullMatrix.length,
      recomputeMs: fromCache ? undefined : Date.now() - requestStart,
    });

    return Response.json(
      {
        ok: true,
        cached: fromCache,
        slot: slotLabel,
        updatedAt: Date.now(),
        newsUpdatedAt,
        count: matrix.length,
        total: fullMatrix.length,
        matrix,
        keyEvents,
        keyEventScoringTemplate: KEY_EVENT_SCORE_TEMPLATE,
        summary,
        targetScoringTemplate: TARGET_SCORE_TEMPLATE,
        fundRecommendations,
        fundRecommendationPanel,
        assetAllocation,
        assetAllocationMeta,
        fundUniverseMeta,
        analysisMeta: {
          rawNewsCount: newsStats.rawCount,
          uniqueNewsCount: newsStats.uniqueCount,
          duplicateNewsCount: newsStats.duplicateCount,
          eventRowsAnalyzed: fullMatrix.length,
          keyEventsCount: fullKeyEvents.length,
          allNewsSummaryCount: fullAllNewsSummary.length,
          keyEventSummaryCount: fullKeyEventSummary.length,
          blendWeights: SUMMARY_BLEND_WEIGHTS,
        },
        promptMeta,
        markdown: formatEventImpactAsMarkdown(matrix),
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error in /api/finance/event-impact:', err);
    recordCacheObservation({
      module: 'event_impact',
      slot: getSixHourSlotLabel(new Date()),
      cached: false,
      sampleSize: 0,
    });
    return Response.json(
      {
        ok: false,
        message: err?.message || 'An error has occurred.',
      },
      { status: 500 },
    );
  }
};
