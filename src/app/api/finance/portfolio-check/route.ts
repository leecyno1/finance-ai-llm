import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createHash } from 'node:crypto';
import { ChatOpenAI } from '@langchain/openai';
import ModelRegistry from '@/lib/models/registry';
import { callTushare, hasTushareToken } from '@/lib/economy/tushare';
import { sanitizeLlmOutput } from '@/lib/utils/llmOutput';
import {
  getConfiguredModelProviders,
  getMiniMaxDefaultModel,
  getPortfolioCheckAgentPromptTemplateConfig,
  getPortfolioCheckAgentSystemPromptConfig,
} from '@/lib/config/serverRegistry';
import {
  ensureFundCodeMap,
  resolveFundCodeFromText,
  type FundCodeMapItem,
} from '@/lib/finance/fundCodeMapping';
import {
  buildPortfolioCheckResult,
  formatPortfolioCheckAsMarkdown,
  getHoldingProfile,
  runPortfolioCheck,
  type PortfolioCheckResult,
} from '@/lib/finance/portfolioCheck';
import { buildTargetFundRecommendations } from '@/lib/finance/fundAllocator';
import { getDailyChatModelSelection } from '@/lib/models/modelRouting';
import type { TargetImpactSummary } from '@/lib/finance/eventImpact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TushareSecurityDetail = {
  inputSymbol: string;
  tsCode: string;
  securityType: 'stock' | 'fund' | 'unknown';
  name: string;
  area: string;
  industryOrType: string;
  listDate: string;
  close: number | null;
  pctChg: number | null;
  pe: number | null;
  pb: number | null;
  totalMvYi: number | null;
  amountYi: number | null;
  tradeDate: string;
  note: string;
};

type AgentAnalysisResult = {
  analysis: string;
  sources: any[];
  model: string;
  providerId: string;
  mode: 'llm' | 'fallback';
  promptTemplateSource: 'env' | 'config' | 'default';
  systemPromptSource: 'env' | 'config' | 'default';
  cacheHit?: boolean;
  error?: string;
};

type PortfolioHoldingRow = PortfolioCheckResult['parsedHoldings'][number];
type HoldingProfile = PortfolioHoldingRow['profile'];

type CacheEntry<T> = {
  value: T;
  updatedAt: number;
  expiresAt: number;
};

type TushareDetailCollection = {
  details: TushareSecurityDetail[];
  meta: {
    requested: number;
    cacheHits: number;
    timeouts: number;
    failures: number;
  };
};

type MarkdownSection = {
  id: 'diagnosis' | 'tushare' | 'agent';
  title: string;
  markdown: string;
};

type HoldingInputPayload = {
  symbol?: string;
  code?: string;
  name?: string;
  weight?: number | string;
  ratio?: number | string;
};

const PORTFOLIO_AGENT_TIMEOUT_MS = 12_000;
const TUSHARE_DETAIL_TIMEOUT_MS = 5_000;
const PORTFOLIO_AGENT_MAX_TOKENS = 900;
const PORTFOLIO_AGENT_MODEL_TIMEOUT_MS = 10_000;
const SECURITY_DETAIL_CACHE_TTL_MS = 15 * 60 * 1000;
const AGENT_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const SECURITY_DETAIL_CACHE_MAX = 256;
const AGENT_ANALYSIS_CACHE_MAX = 64;

const securityDetailCache = new Map<
  string,
  CacheEntry<TushareSecurityDetail | null>
>();
const agentAnalysisCache = new Map<string, CacheEntry<AgentAnalysisResult>>();

const normalizeSymbol = (v: string) =>
  (v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_.-]/g, '');

const normalizeLooseText = (v: string) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const readCacheEntry = <T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
): CacheEntry<T> | null => {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry;
};

const writeCacheEntry = <T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxSize: number,
) => {
  const now = Date.now();
  if (store.has(key)) {
    store.delete(key);
  }
  store.set(key, {
    value,
    updatedAt: now,
    expiresAt: now + ttlMs,
  });

  while (store.size > maxSize) {
    const oldest = store.keys().next().value;
    if (!oldest) break;
    store.delete(oldest);
  }
};

const toTsCode = (symbol: string) => {
  const s = normalizeSymbol(symbol);
  if (!s) return '';
  if (/^\d{6}\.(SH|SZ|BJ|OF)$/.test(s)) return s;
  if (/^(SH|SZ|BJ)\d{6}$/.test(s)) return `${s.slice(2)}.${s.slice(0, 2)}`;
  if (/^(OF)\d{6}$/.test(s)) return `${s.slice(2)}.OF`;
  if (/^\d{6}$/.test(s)) {
    const p = s[0];
    if (p === '6' || p === '5' || p === '9') return `${s}.SH`;
    if (p === '8' || p === '4') return `${s}.BJ`;
    if (p === '0' || p === '1' || p === '2' || p === '3') return `${s}.SZ`;
  }
  return '';
};

const toTsCodeCandidates = (
  symbol: string,
  fundMapItems: FundCodeMapItem[] = [],
) => {
  const s = normalizeSymbol(symbol);
  const out: string[] = [];
  if (!s) return out;

  const direct = toTsCode(s);
  if (direct) out.push(direct);

  if (/^\d{6}$/.test(s)) {
    out.push(`${s}.OF`);
    out.push(`${s}.SH`);
    out.push(`${s}.SZ`);
    out.push(`${s}.BJ`);
  }

  const resolvedFund = resolveFundCodeFromText(fundMapItems, symbol);
  if (resolvedFund?.tsCode) {
    out.push(normalizeSymbol(resolvedFund.tsCode));
  }

  return Array.from(new Set(out.filter(Boolean)));
};

const looksLikeFundQuery = (input: string) =>
  /基金|etf|lof|fof|qdii|联接|债券|货币|指数增强|a类|c类/i.test(
    String(input || ''),
  );

const guessSecurityIntent = (
  inputSymbol: string,
  fundMapItems: FundCodeMapItem[] = [],
): 'stock' | 'fund' | 'auto' => {
  const raw = String(inputSymbol || '').trim();
  const normalized = normalizeSymbol(raw);
  const rawLoose = normalizeLooseText(raw);
  const mappedFund = resolveFundCodeFromText(fundMapItems, inputSymbol);
  const mappedFundName = normalizeLooseText(mappedFund?.name || '');

  if (/\.OF$/.test(normalized) || /^OF\d{6}$/.test(normalized)) {
    return 'fund';
  }

  if (
    mappedFund &&
    mappedFundName &&
    (rawLoose === mappedFundName || looksLikeFundQuery(raw))
  ) {
    return 'fund';
  }

  if (/^\d{6}$/.test(normalized) || /^\d{6}\.(SH|SZ|BJ)$/.test(normalized)) {
    const prefix = normalized[0];
    if (prefix === '1' || prefix === '5') {
      return mappedFund ? 'fund' : 'auto';
    }
    if (prefix === '0' || prefix === '2' || prefix === '3' || prefix === '4' || prefix === '6' || prefix === '8' || prefix === '9') {
      return 'stock';
    }
  }

  if (mappedFund?.tsCode) {
    return 'fund';
  }

  return 'auto';
};

const buildSecurityFallbackDetail = (
  inputSymbol: string,
  fundMapItems: FundCodeMapItem[],
  note: string,
  candidates = toTsCodeCandidates(inputSymbol, fundMapItems),
): TushareSecurityDetail | null => {
  const normalizedInput = normalizeSymbol(inputSymbol);
  const mappedFund = resolveFundCodeFromText(fundMapItems, inputSymbol);

  if (mappedFund?.tsCode) {
    return {
      inputSymbol,
      tsCode: mappedFund.tsCode,
      securityType: 'fund',
      name: mappedFund.name || inputSymbol,
      area: 'CN',
      industryOrType: mappedFund.fundType || mappedFund.management || '基金',
      listDate: mappedFund.listDate || mappedFund.foundDate || '-',
      close: null,
      pctChg: null,
      pe: null,
      pb: null,
      totalMvYi: null,
      amountYi: null,
      tradeDate: '',
      note,
    };
  }

  const stockTsCode =
    candidates.find((x) => /\.(SH|SZ|BJ)$/.test(x)) ||
    toTsCode(normalizedInput) ||
    '';
  if (stockTsCode && /\.(SH|SZ|BJ)$/.test(stockTsCode)) {
    return {
      inputSymbol,
      tsCode: stockTsCode,
      securityType: 'stock',
      name: inputSymbol,
      area: 'CN',
      industryOrType: 'A股',
      listDate: '-',
      close: null,
      pctChg: null,
      pe: null,
      pb: null,
      totalMvYi: null,
      amountYi: null,
      tradeDate: '',
      note,
    };
  }

  if (!candidates.length && !normalizedInput) return null;

  return {
    inputSymbol,
    tsCode: candidates[0] || normalizedInput || inputSymbol,
    securityType: 'unknown',
    name: inputSymbol,
    area: '-',
    industryOrType: '-',
    listDate: '-',
    close: null,
    pctChg: null,
    pe: null,
    pb: null,
    totalMvYi: null,
    amountYi: null,
    tradeDate: '',
    note,
  };
};

const toNumber = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toYiFromWan = (v: unknown) => {
  const n = toNumber(v);
  if (n === null) return null;
  return Number((n / 10000).toFixed(2));
};

const toYiFromQian = (v: unknown) => {
  const n = toNumber(v);
  if (n === null) return null;
  return Number((n / 100000).toFixed(2));
};

const findStockBasicByTsCode = async (tsCode: string) => {
  const fields = ['ts_code', 'symbol', 'name', 'area', 'industry', 'market', 'list_date'];
  for (const listStatus of ['', 'L', 'P', 'D']) {
    const params = listStatus
      ? { ts_code: tsCode, list_status: listStatus }
      : { ts_code: tsCode };
    const rows = await callTushare('stock_basic', params, fields).catch(() => []);
    if (rows[0]) return rows[0];
  }
  return null;
};

const findFundBasicByTsCode = async (tsCode: string) => {
  const fields = ['ts_code', 'name', 'management', 'fund_type', 'market', 'list_date', 'found_date'];
  const rows = await callTushare('fund_basic', { ts_code: tsCode }, fields).catch(() => []);
  return rows[0] || null;
};

const queryStockDetail = async (
  inputSymbol: string,
  tsCode: string,
): Promise<TushareSecurityDetail | null> => {
  const stockBasic = await findStockBasicByTsCode(tsCode);
  if (!stockBasic) return null;

  const detail: TushareSecurityDetail = {
    inputSymbol,
    tsCode,
    securityType: 'stock',
    name: String(stockBasic.name || inputSymbol),
    area: String(stockBasic.area || '-'),
    industryOrType: String(stockBasic.industry || stockBasic.market || '-'),
    listDate: String(stockBasic.list_date || '-'),
    close: null,
    pctChg: null,
    pe: null,
    pb: null,
    totalMvYi: null,
    amountYi: null,
    tradeDate: '',
    note: '',
  };

  const [dailyRows, dailyBasicRows] = await Promise.all([
    callTushare(
      'daily',
      { ts_code: tsCode, limit: 1 },
      ['ts_code', 'trade_date', 'close', 'pct_chg', 'amount'],
    ).catch(() => []),
    callTushare(
      'daily_basic',
      { ts_code: tsCode, limit: 1 },
      ['ts_code', 'trade_date', 'pe', 'pb', 'total_mv'],
    ).catch(() => []),
  ]);

  const daily = dailyRows[0];
  const dailyBasic = dailyBasicRows[0];
  detail.tradeDate = String(daily?.trade_date || dailyBasic?.trade_date || '');
  detail.close = toNumber(daily?.close);
  detail.pctChg = toNumber(daily?.pct_chg);
  detail.pe = toNumber(dailyBasic?.pe);
  detail.pb = toNumber(dailyBasic?.pb);
  detail.totalMvYi = toYiFromWan(dailyBasic?.total_mv);
  detail.amountYi = toYiFromQian(daily?.amount);
  detail.note = daily ? '' : '未获取到日线行情';
  return detail;
};

const queryFundDetail = async (
  inputSymbol: string,
  tsCode: string,
): Promise<TushareSecurityDetail | null> => {
  const fundBasic = await findFundBasicByTsCode(tsCode);
  if (!fundBasic) return null;

  const detail: TushareSecurityDetail = {
    inputSymbol,
    tsCode,
    securityType: 'fund',
    name: String(fundBasic.name || inputSymbol),
    area: 'CN',
    industryOrType: String(fundBasic.fund_type || fundBasic.management || '基金'),
    listDate: String(fundBasic.list_date || fundBasic.found_date || '-'),
    close: null,
    pctChg: null,
    pe: null,
    pb: null,
    totalMvYi: null,
    amountYi: null,
    tradeDate: '',
    note: '',
  };

  const fundDailyRows = await callTushare(
    'fund_daily',
    { ts_code: tsCode, limit: 1 },
    ['ts_code', 'trade_date', 'close', 'pct_chg', 'amount'],
  ).catch(() => []);

  const daily = fundDailyRows[0];
  detail.tradeDate = String(daily?.trade_date || '');
  detail.close = toNumber(daily?.close);
  detail.pctChg = toNumber(daily?.pct_chg);
  detail.amountYi = toYiFromQian(daily?.amount);
  detail.note = daily ? '' : '未获取到基金日线行情';
  return detail;
};

const querySecurityDetailFromTushare = async (
  inputSymbol: string,
  fundMapItems: FundCodeMapItem[] = [],
): Promise<TushareSecurityDetail | null> => {
  const candidates = toTsCodeCandidates(inputSymbol, fundMapItems);
  const normalizedInput = normalizeSymbol(inputSymbol);
  const probeOrder = guessSecurityIntent(inputSymbol, fundMapItems);
  if (!candidates.length) return null;

  try {
    for (const tsCode of candidates) {
      const isStockMarketCode = /\.(SH|SZ|BJ)$/.test(tsCode);
      const canProbeFund = /\.OF$/.test(tsCode) || isStockMarketCode;
      const shouldProbeStockFirst =
        probeOrder === 'stock' ||
        (probeOrder === 'auto' && !/^[15]/.test(normalizedInput));

      if (shouldProbeStockFirst && isStockMarketCode) {
        const stockDetail = await queryStockDetail(inputSymbol, tsCode);
        if (stockDetail) return stockDetail;
      }

      if (canProbeFund) {
        const fundDetail = await queryFundDetail(inputSymbol, tsCode);
        if (fundDetail) return fundDetail;
      }

      if (!shouldProbeStockFirst && isStockMarketCode) {
        const stockDetail = await queryStockDetail(inputSymbol, tsCode);
        if (stockDetail) return stockDetail;
      }
    }

    return buildSecurityFallbackDetail(
      inputSymbol,
      fundMapItems,
      `TuShare 未找到对应证券（候选: ${candidates.join(', ')}）`,
      candidates,
    );
  } catch (err: any) {
    return buildSecurityFallbackDetail(
      inputSymbol,
      fundMapItems,
      `TuShare 查询失败: ${err?.message || 'unknown'}`,
      candidates,
    );
  }
};

const collectTushareDetails = async (
  result: PortfolioCheckResult | null,
  fundMapItems: FundCodeMapItem[] = [],
) : Promise<TushareDetailCollection> => {
  if (!result || !result.parsedHoldings.length) {
    return {
      details: [],
      meta: { requested: 0, cacheHits: 0, timeouts: 0, failures: 0 },
    };
  }

  const cnCandidates = result.parsedHoldings
    .map((h) => normalizeSymbol(h.symbol))
    .filter(Boolean);

  const deduped = Array.from(new Set(cnCandidates));
  if (!deduped.length) {
    return {
      details: [],
      meta: { requested: 0, cacheHits: 0, timeouts: 0, failures: 0 },
    };
  }

  let cacheHits = 0;
  let timeouts = 0;
  let failures = 0;
  const details = await Promise.all(
    deduped.map(async (symbol) => {
      const cacheKey = normalizeSymbol(symbol);
      const cached = readCacheEntry(securityDetailCache, cacheKey);
      if (cached) {
        cacheHits += 1;
        return cached.value;
      }

      try {
        const detail = await withTimeout(
          querySecurityDetailFromTushare(symbol, fundMapItems),
          TUSHARE_DETAIL_TIMEOUT_MS,
        );
        writeCacheEntry(
          securityDetailCache,
          cacheKey,
          detail,
          SECURITY_DETAIL_CACHE_TTL_MS,
          SECURITY_DETAIL_CACHE_MAX,
        );
        return detail;
      } catch {
        timeouts += 1;
        const fallback = buildSecurityFallbackDetail(
          symbol,
          fundMapItems,
          `TuShare 查询超时，已回退至代码映射（>${Math.round(
            TUSHARE_DETAIL_TIMEOUT_MS / 1000,
          )}s）`,
        );
        if (!fallback) {
          failures += 1;
          return null;
        }
        writeCacheEntry(
          securityDetailCache,
          cacheKey,
          fallback,
          SECURITY_DETAIL_CACHE_TTL_MS,
          SECURITY_DETAIL_CACHE_MAX,
        );
        return fallback;
      }
    }),
  );

  return {
    details: details.filter((x): x is TushareSecurityDetail => Boolean(x)),
    meta: {
      requested: deduped.length,
      cacheHits,
      timeouts,
      failures,
    },
  };
};

const resolveStockTsCodeByName = async (name: string) => {
  const q = String(name || '').trim();
  if (!q || !hasTushareToken()) return '';

  const fields = ['ts_code', 'symbol', 'name'];
  const exactRows = await callTushare('stock_basic', { name: q }, fields).catch(() => []);
  const exact = (exactRows as Array<Record<string, unknown>>).find(
    (row) => String(row.name || '').trim() === q,
  );
  if (exact?.ts_code) return normalizeSymbol(String(exact.ts_code));

  const searchRows = await callTushare('stock_basic', {}, fields).catch(() => []);
  const fuzzy = (searchRows as Array<Record<string, unknown>>).find((row) => {
    const rowName = String(row.name || '').trim();
    return rowName === q || rowName.includes(q) || q.includes(rowName);
  });

  return fuzzy?.ts_code ? normalizeSymbol(String(fuzzy.ts_code)) : '';
};

const resolveHoldingPayloadSymbol = async (
  rawSymbol: string,
  rawName: string,
  fundMapItems: FundCodeMapItem[] = [],
) => {
  const symbol = normalizeSymbol(rawSymbol);
  const codeResolved =
    toTsCode(symbol) ||
    resolveFundCodeFromText(fundMapItems, rawSymbol)?.tsCode ||
    resolveFundCodeFromText(fundMapItems, rawName)?.tsCode ||
    symbol;

  if (codeResolved) return codeResolved;
  return resolveStockTsCodeByName(rawName);
};

const parseHoldingPayloadRows = async (
  holdings: HoldingInputPayload[] | undefined,
  fundMapItems: FundCodeMapItem[] = [],
) => {
  if (!Array.isArray(holdings)) return [];

  const rows = await Promise.all(
    holdings.map(async (row) => {
      const rawSymbol = String(row?.symbol || row?.code || '').trim();
      const rawName = String(row?.name || '').trim();
      const weightRaw = row?.weight ?? row?.ratio;
      const weight = Number(weightRaw);
      if (!Number.isFinite(weight) || weight <= 0) return null;

      const codeResolved = await resolveHoldingPayloadSymbol(rawSymbol, rawName, fundMapItems);
      if (!codeResolved) return null;
      return {
        symbol: codeResolved,
        weight,
      };
    }),
  );

  return rows.filter((x): x is { symbol: string; weight: number } => Boolean(x));
};

const clampFactor = (value: number) =>
  Number(Math.max(-1, Math.min(1, value)).toFixed(3));

const normalizeFactorMap = (factors: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(factors).map(([key, value]) => [key, clampFactor(value)]),
  );

const inferRegionFromText = (text: string): HoldingProfile['region'] => {
  if (/港股|恒生|香港|h股/i.test(text)) return 'HK';
  if (/美股|美国|标普|纳指|纳斯达克|纳斯达克100|道琼斯|s&p|dow|nasdaq/i.test(text)) {
    return 'US';
  }
  if (/欧洲|欧股|德国|法国|英国|eu/i.test(text)) return 'EU';
  if (/日本|日经|东证|nikkei|japan/i.test(text)) return 'JP';
  if (/全球|海外|qdii|international|world/i.test(text)) return 'Global';
  return 'CN';
};

const inferAssetClass = (
  detail: TushareSecurityDetail | null | undefined,
  fallbackText: string,
): HoldingProfile['assetClass'] => {
  const text = `${detail?.name || ''} ${detail?.industryOrType || ''} ${fallbackText}`.toLowerCase();
  if (/货币|现金管理|cash/.test(text)) return 'Cash';
  if (/债|国债|信用债|可转债|中短债|纯债|bond/.test(text)) return 'Bond';
  if (/reit/.test(text)) return 'REIT';
  if (/黄金|商品|原油|贵金属|commodity|gold|oil/.test(text)) return 'Commodity';
  return 'Equity';
};

const inferSectorLabel = (
  detail: TushareSecurityDetail | null | undefined,
  fallbackText: string,
  assetClass: HoldingProfile['assetClass'],
): string => {
  const primary = String(detail?.industryOrType || '').trim();
  const text = `${detail?.name || ''} ${primary} ${fallbackText}`.toLowerCase();

  if (assetClass === 'Bond') return /可转债/.test(text) ? '可转债基金' : '债券基金';
  if (assetClass === 'Cash') return '货币基金';
  if (assetClass === 'Commodity') return /黄金|贵金属|gold/.test(text) ? '贵金属' : '商品基金';
  if (assetClass === 'REIT') return 'REITs';

  if (/沪深300|csi ?300/i.test(text)) return '沪深300';
  if (/上证50/.test(text)) return '上证50';
  if (/中证500/.test(text)) return '中证500';
  if (/中证1000/.test(text)) return '中证1000';
  if (/科创50/.test(text)) return '科创50';
  if (/创业板/.test(text)) return '创业板指';
  if (/红利/.test(text)) return '红利策略';
  if (/中证a50|a股宽基|宽基/.test(text)) return 'A股宽基';
  if (/恒生|港股/.test(text)) return '港股宽基';
  if (/标普|纳指|纳斯达克|道琼斯|美股/.test(text)) return '美股宽基';
  if (/半导体|芯片|电子/.test(text)) return '半导体';
  if (/软件|计算机|ai|人工智能|通信|传媒|互联网|科技/.test(text)) return '科技';
  if (/银行/.test(text)) return '银行';
  if (/保险/.test(text)) return '保险';
  if (/证券|券商/.test(text)) return '证券';
  if (/金融/.test(text)) return '金融';
  if (/白酒/.test(text)) return '白酒';
  if (/食品饮料/.test(text)) return '食品饮料';
  if (/家电/.test(text)) return '家电';
  if (/零售|商贸/.test(text)) return '零售';
  if (/消费/.test(text)) return '消费';
  if (/医药|生物|医疗/.test(text)) return '医药';
  if (/新能源|光伏|锂电|储能|风电|电车/.test(text)) return '新能源';
  if (/煤炭|石油|天然气|有色|钢铁|资源|黄金/.test(text)) return '资源';
  if (/地产|建筑|建材|基建/.test(text)) return '地产基建';

  if (primary && primary !== '-' && !/股票型|混合型|指数型|etf|lof|qdii/i.test(primary)) {
    return primary;
  }
  if (primary && primary !== '-') return primary;
  return assetClass === 'Equity' ? '权益基金' : '未知行业';
};

const inferBaseFactors = (
  assetClass: HoldingProfile['assetClass'],
  region: HoldingProfile['region'],
): Record<string, number> => {
  if (assetClass === 'Cash') {
    return { beta: -0.2, duration: 0.05, tech: 0, usd: 0.05, china: 0.1, inflation: -0.1 };
  }
  if (assetClass === 'Bond') {
    return region === 'CN'
      ? { beta: -0.12, duration: 0.65, tech: 0, usd: -0.05, china: 0.85, inflation: -0.35 }
      : { beta: -0.18, duration: 0.75, tech: 0, usd: 0.1, china: 0.05, inflation: -0.45 };
  }
  if (assetClass === 'Commodity') {
    return { beta: 0.15, duration: 0.05, tech: 0, usd: -0.35, china: 0.15, inflation: 0.78 };
  }
  if (assetClass === 'REIT') {
    return { beta: 0.45, duration: 0.25, tech: 0, usd: 0.05, china: region === 'CN' ? 0.55 : 0.1, inflation: 0.25 };
  }
  if (region === 'US') {
    return { beta: 0.82, duration: -0.18, tech: 0.35, usd: 0.2, china: 0.05, inflation: -0.12 };
  }
  if (region === 'HK') {
    return { beta: 0.82, duration: -0.12, tech: 0.25, usd: 0.08, china: 0.72, inflation: -0.08 };
  }
  if (region === 'EU') {
    return { beta: 0.74, duration: -0.1, tech: 0.15, usd: -0.05, china: 0.05, inflation: -0.05 };
  }
  if (region === 'JP') {
    return { beta: 0.72, duration: -0.08, tech: 0.12, usd: -0.05, china: 0.02, inflation: -0.02 };
  }
  if (region === 'Global') {
    return { beta: 0.76, duration: -0.1, tech: 0.2, usd: 0.05, china: 0.2, inflation: -0.05 };
  }
  return { beta: 0.78, duration: -0.1, tech: 0.15, usd: -0.05, china: 0.95, inflation: -0.05 };
};

const applySectorFactorTilt = (
  sector: string,
  baseFactors: Record<string, number>,
): Record<string, number> => {
  const next = { ...baseFactors };
  const sectorText = sector.toLowerCase();

  if (/半导体|科技/.test(sectorText)) {
    next.beta += 0.1;
    next.tech += 0.65;
    next.usd += 0.08;
    next.inflation -= 0.08;
  } else if (/金融|银行|保险|证券/.test(sectorText)) {
    next.beta -= 0.12;
    next.duration += 0.12;
    next.tech -= 0.18;
    next.inflation += 0.05;
    if (/银行/.test(sectorText)) {
      next.beta -= 0.06;
      next.duration += 0.08;
      next.inflation += 0.04;
    } else if (/证券/.test(sectorText)) {
      next.beta += 0.12;
    }
  } else if (/消费|白酒|食品饮料|家电/.test(sectorText)) {
    next.beta -= 0.03;
    next.china += 0.04;
    next.inflation += 0.08;
    if (/白酒/.test(sectorText)) {
      next.beta -= 0.05;
      next.inflation += 0.06;
    }
  } else if (/医药|医疗|生物/.test(sectorText)) {
    next.beta -= 0.05;
    next.tech += 0.22;
    next.inflation -= 0.04;
  } else if (/新能源|光伏|锂电|储能/.test(sectorText)) {
    next.beta += 0.08;
    next.tech += 0.35;
    next.inflation += 0.12;
  } else if (/资源|煤炭|石油|有色|贵金属/.test(sectorText)) {
    next.beta += 0.04;
    next.tech -= 0.08;
    next.usd -= 0.08;
    next.inflation += 0.55;
  } else if (/地产|基建/.test(sectorText)) {
    next.beta -= 0.04;
    next.duration += 0.12;
    next.inflation += 0.15;
  } else if (/宽基|沪深300|上证50|中证500|中证1000|科创50|创业板/.test(sectorText)) {
    next.beta = Math.max(next.beta, 0.8);
    next.tech *= 0.7;
    if (/中证500|中证1000|创业板|科创50/.test(sectorText)) {
      next.beta += 0.08;
      next.tech += 0.12;
    }
  }

  return normalizeFactorMap(next);
};

const buildProfileFromSecurityContext = (
  row: PortfolioHoldingRow,
  detail: TushareSecurityDetail | undefined,
  fundMapItem: FundCodeMapItem | undefined,
): HoldingProfile => {
  const fallbackProfile = getHoldingProfile(row.symbol);
  const fallbackText = [
    fundMapItem?.name || '',
    fundMapItem?.fundType || '',
    fundMapItem?.management || '',
  ].join(' ');
  const sourceText = `${detail?.name || ''} ${detail?.industryOrType || ''} ${fallbackText}`;

  const assetClass = inferAssetClass(detail, fallbackText);
  const region =
    assetClass === 'Equity' || assetClass === 'Bond' || assetClass === 'REIT'
      ? inferRegionFromText(sourceText)
      : assetClass === 'Commodity'
        ? 'Global'
        : fallbackProfile.region;
  const sector = inferSectorLabel(detail, fallbackText, assetClass);
  const baseFactors = inferBaseFactors(assetClass, region);
  const factors = applySectorFactorTilt(sector, baseFactors);

  return {
    symbol: row.symbol,
    name: detail?.name || fundMapItem?.name || fallbackProfile.name,
    assetClass,
    region,
    sector,
    factors,
  };
};

const enrichPortfolioCheckResult = (
  result: PortfolioCheckResult | null,
  tushareDetails: TushareSecurityDetail[],
  fundMapItems: FundCodeMapItem[] = [],
) => {
  if (!result) return null;

  const detailsBySymbol = new Map<string, TushareSecurityDetail>();
  const fundMapByKey = new Map<string, FundCodeMapItem>();

  tushareDetails.forEach((detail) => {
    detailsBySymbol.set(normalizeSymbol(detail.inputSymbol), detail);
    detailsBySymbol.set(normalizeSymbol(detail.tsCode), detail);
  });

  fundMapItems.forEach((item) => {
    fundMapByKey.set(normalizeSymbol(item.tsCode), item);
    fundMapByKey.set(normalizeSymbol(item.code), item);
    fundMapByKey.set(normalizeLooseText(item.name), item);
  });

  const enrichedRows = result.parsedHoldings.map((row) => {
    const symbolKey = normalizeSymbol(row.symbol);
    const detail = detailsBySymbol.get(symbolKey);
    const fundMapItem =
      fundMapByKey.get(symbolKey) ||
      fundMapByKey.get(normalizeSymbol(detail?.tsCode || '')) ||
      fundMapByKey.get(normalizeLooseText(detail?.name || ''));

    const shouldEnrich =
      Boolean(detail || fundMapItem) &&
      (row.profile.region === 'Global' ||
        row.profile.sector === '未知行业' ||
        row.profile.name === row.symbol);

    if (!shouldEnrich) return row;

    return {
      ...row,
      profile: buildProfileFromSecurityContext(row, detail, fundMapItem),
    };
  });

  return buildPortfolioCheckResult(enrichedRows);
};

const buildPortfolioFundActionRows = (
  result: PortfolioCheckResult | null,
): TargetImpactSummary[] => {
  if (!result) return [];

  const rows: TargetImpactSummary[] = [];
  const topSector = Object.entries(result.exposure.bySector).sort((a, b) => b[1] - a[1])[0];
  const hasConcentrationReplacement = Boolean(topSector && topSector[1] > 35);

  if (hasConcentrationReplacement && topSector) {
    rows.push({
      target: '中短债 红利低波 债券基金',
      positiveWeight: 14,
      mixedWeight: 0,
      negativeWeight: 0,
      direction: 'positive',
      confidence: Math.min(0.86, Math.max(0.62, topSector[1] / 100 + 0.42)),
      eventCount: 1,
      totalWeight: Number(topSector[1].toFixed(2)),
      compositeScore: Number(Math.min(95, topSector[1] + 35).toFixed(1)),
      scoreBreakdown: {
        confidence: 0.72,
        eventCoverage: 0.58,
        signalClarity: 0.82,
      },
    });
  }

  const assetClass = result.exposure.byAssetClass;
  if (!hasConcentrationReplacement && (assetClass.Bond || 0) < 15) {
    rows.push({
      target: '中短债 债券基金',
      positiveWeight: 18,
      mixedWeight: 0,
      negativeWeight: 0,
      direction: 'positive',
      confidence: 0.72,
      eventCount: 1,
      totalWeight: 18,
      compositeScore: 68,
      scoreBreakdown: { confidence: 0.72, eventCoverage: 0.5, signalClarity: 0.75 },
    });
  }

  if ((assetClass.Commodity || 0) < 3) {
    rows.push({
      target: '黄金 贵金属',
      positiveWeight: 8,
      mixedWeight: 0,
      negativeWeight: 0,
      direction: 'positive',
      confidence: 0.66,
      eventCount: 1,
      totalWeight: 8,
      compositeScore: 58,
      scoreBreakdown: { confidence: 0.66, eventCoverage: 0.42, signalClarity: 0.66 },
    });
  }

  return rows.slice(0, 3);
};

const attachFundActionRecommendations = (result: PortfolioCheckResult | null) => {
  if (!result) return result;
  const summaryRows = buildPortfolioFundActionRows(result);
  const concentrationSector = Object.entries(result.exposure.bySector).sort((a, b) => b[1] - a[1])[0];
  const concentrationReplacementTarget = concentrationSector && concentrationSector[1] > 35 ? '中短债 红利低波 债券基金' : '';
  const recommendations = buildTargetFundRecommendations(summaryRows, {
    topTargets: 3,
    topFundsPerTarget: 2,
  })
    .filter((row) => row.funds.length > 0)
    .map((row) => {
      const isConcentrationReplacement = row.target === concentrationReplacementTarget && concentrationSector;
      return {
        action:
          isConcentrationReplacement || row.direction === 'negative'
            ? '风险替代'
            : '配置补充',
        target: isConcentrationReplacement
          ? `${concentrationSector[0]}集中替代：${row.target}`
          : row.target,
        funds: row.funds.map((fund) =>
          isConcentrationReplacement
            ? {
                ...fund,
                reason: `${fund.reason || '基金定位偏稳健'}；用于承接${concentrationSector[0]}减仓资金，降低单一行业暴露。`,
                riskPrompt: `这是风险替代而非进攻加仓，建议用分批再平衡方式把${concentrationSector[0]}集中度降至目标区间。基金风险等级 ${fund.riskLevel || 'R3-中风险'}，需结合你的回撤承受能力。`,
              }
            : fund,
        ),
      };
    });

  return {
    ...result,
    fundActionRecommendations: recommendations,
  };
};

const formatFundActionRecommendationsMarkdown = (
  result: PortfolioCheckResult | null,
) => {
  const recommendations = result?.fundActionRecommendations || [];
  if (!recommendations.length) return '';

  const lines = [
    '## 备选基金动作',
    '',
    '| 动作 | 目标 | 基金 | 风险 | 匹配说明 |',
    '| --- | --- | --- | --- | --- |',
  ];

  recommendations.forEach((row) => {
    row.funds.slice(0, 2).forEach((fund) => {
      lines.push(
        `| ${row.action} | ${row.target} | ${fund.name}(${fund.tsCode}) | ${fund.riskLevel || '-'} | ${fund.reason || fund.riskPrompt || '-'} |`,
      );
    });
  });

  return lines.join('\n');
};

const formatTushareDetailsMarkdown = (details: TushareSecurityDetail[]) => {
  const lines: string[] = [];
  lines.push('## TuShare 详细信息');
  lines.push('');

  if (!details.length) {
    lines.push('- 未识别到可映射的国内证券代码（A股/ETF/基金）。');
    return lines.join('\n');
  }

  lines.push('| 输入代码 | TS代码 | 名称 | 类型 | 行业/基金类型 | 收盘 | 涨跌幅 | PE | PB | 总市值(亿元) | 成交额(亿元) | 日期 | 备注 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const d of details) {
    const close = d.close === null ? '-' : d.close.toFixed(2);
    const pct = d.pctChg === null ? '-' : `${d.pctChg.toFixed(2)}%`;
    const pe = d.pe === null ? '-' : d.pe.toFixed(2);
    const pb = d.pb === null ? '-' : d.pb.toFixed(2);
    const totalMv = d.totalMvYi === null ? '-' : d.totalMvYi.toFixed(2);
    const amount = d.amountYi === null ? '-' : d.amountYi.toFixed(2);

    lines.push(
      `| ${d.inputSymbol} | ${d.tsCode} | ${d.name} | ${d.securityType} | ${d.industryOrType} | ${close} | ${pct} | ${pe} | ${pb} | ${totalMv} | ${amount} | ${d.tradeDate || '-'} | ${d.note || '-'} |`,
    );
  }

  return lines.join('\n');
};

const contentToText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '');
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return String(content ?? '').trim();
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`agent timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });

const pickDefaultChatModel = async (_registry: ModelRegistry) => {
  return getDailyChatModelSelection();
};

const tunePortfolioAgentModel = (llm: unknown) => {
  const model = llm as Partial<ChatOpenAI> & {
    maxTokens?: number;
    timeout?: number;
    temperature?: number;
  };

  model.temperature = 0.1;
  model.maxTokens = PORTFOLIO_AGENT_MAX_TOKENS;
  model.timeout = PORTFOLIO_AGENT_MODEL_TIMEOUT_MS;
};

const buildAgentPrompt = (
  input: string,
  result: PortfolioCheckResult,
  tushareDetails: TushareSecurityDetail[],
) => {
  const topHoldings = result.parsedHoldings
    .sort((a, b) => b.normalizedWeight - a.normalizedWeight)
    .slice(0, 8)
    .map((h) => `${h.symbol} ${h.normalizedWeight.toFixed(2)}%`)
    .join('；');

  const topSectors = Object.entries(result.exposure.bySector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} ${v.toFixed(2)}%`)
    .join('；');

  const tushareBrief = tushareDetails
    .slice(0, 12)
    .map(
      (x) =>
        `${x.tsCode} ${x.name} close=${x.close ?? '-'} pct=${x.pctChg ?? '-'} pe=${x.pe ?? '-'} pb=${x.pb ?? '-'} mvYi=${x.totalMvYi ?? '-'} note=${x.note || '-'}`,
    )
    .join('\n');

  const defaultTemplate = [
    '你是资深中文投研分析师。请基于“组合体检 + TuShare 明细”输出一份短而密的 Markdown 报告。',
    '',
    '用户输入：',
    '{{input_text}}',
    '',
    '组合核心数据：',
    '风险评分: {{risk_score}}/100',
    '主要持仓: {{top_holdings}}',
    '行业暴露(前5): {{top_sectors}}',
    '主要因子: {{top_factors}}',
    '',
    'TuShare证券明细：',
    '{{tushare_brief}}',
    '',
    '严格输出以下结构，每段最多3条要点，总字数控制在700字以内：',
    '## 综合结论',
    '## 主要机会',
    '## 主要风险',
    '## 调整建议',
    '## 监控触发',
    '',
    '要求：给出数字化仓位区间；不要重复前文表格；保持研究口径，不输出确定性买卖承诺。',
  ].join('\n');

  const values: Record<string, string> = {
    input_text: input,
    risk_score: String(result.riskScore),
    top_holdings: topHoldings || '无',
    top_sectors: topSectors || '无',
    top_factors:
      result.topFactorSensitivities.map((x) => `${x.factor}:${x.value.toFixed(3)}`).join('；') ||
      '无',
    tushare_brief: tushareBrief || '无',
  };

  const configuredTemplate = getPortfolioCheckAgentPromptTemplateConfig();
  const template = configuredTemplate.value || defaultTemplate;
  let rendered = template;
  Object.entries(values).forEach(([k, v]) => {
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
  });

  const missingPlaceholder = !/\{\{\s*(input_text|risk_score|top_holdings|top_sectors|top_factors|tushare_brief)\s*\}\}/.test(
    template,
  );
  if (missingPlaceholder) {
    return {
      prompt: [
      rendered,
      '',
      '【补充数据】',
      `风险评分: ${values.risk_score}/100`,
      `主要持仓: ${values.top_holdings}`,
      `行业暴露(前5): ${values.top_sectors}`,
      `主要因子: ${values.top_factors}`,
      'TuShare证券明细:',
      values.tushare_brief,
      ].join('\n'),
      templateSource: configuredTemplate.source as 'env' | 'config' | 'default',
    };
  }
  return {
    prompt: rendered,
    templateSource: configuredTemplate.source as 'env' | 'config' | 'default',
  };
};

const classifyRiskBand = (riskScore: number) => {
  if (riskScore >= 75) return '偏高';
  if (riskScore >= 55) return '中等';
  return '偏低';
};

const formatSignedPct = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return null;
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const buildFallbackAgentAnalysis = (
  result: PortfolioCheckResult,
  tushareDetails: TushareSecurityDetail[],
  reason: string,
) => {
  const riskBand = classifyRiskBand(result.riskScore);
  const topHolding = [...result.parsedHoldings].sort(
    (a, b) => b.normalizedWeight - a.normalizedWeight,
  )[0];
  const topSector = Object.entries(result.exposure.bySector).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const topRegion = Object.entries(result.exposure.byRegion).sort(
    (a, b) => b[1] - a[1],
  )[0];
  const topFactor = result.topFactorSensitivities[0];
  const gainers = tushareDetails
    .filter((x) => (x.pctChg ?? 0) > 0)
    .sort((a, b) => (b.pctChg ?? 0) - (a.pctChg ?? 0))
    .slice(0, 2);
  const losers = tushareDetails
    .filter((x) => (x.pctChg ?? 0) < 0)
    .sort((a, b) => (a.pctChg ?? 0) - (b.pctChg ?? 0))
    .slice(0, 2);

  const opportunityLines = [
    topHolding
      ? `- 当前第一大持仓为 **${topHolding.profile.name}**，权重 **${topHolding.normalizedWeight.toFixed(
          2,
        )}%**。如果这就是你的核心观点仓位，组合表达已经足够明确。`
      : '',
    gainers.length
      ? `- 最近相对偏强的持仓包括 ${gainers
          .map((x) => `**${x.name}**(${formatSignedPct(x.pctChg)})`)
          .join('、')}，说明组合里仍有承接短期风险偏好的弹性资产。`
      : '- 近期没有显著强势持仓，若你判断市场会修复，需要确认组合里是否存在真正的进攻资产。',
    topFactor && topFactor.value > 0
      ? `- 当前最显著的正向因子暴露是 **${topFactor.factor}**（${topFactor.value.toFixed(
          3,
        )}），若市场继续朝这一因子友好的方向演化，组合弹性会更明显。`
      : '',
  ].filter(Boolean);

  const riskLines = [
    topSector && topSector[1] >= 35
      ? `- 行业集中度偏高，当前 **${topSector[0]}** 暴露达到 **${topSector[1].toFixed(
          2,
        )}%**，一旦板块进入回撤，组合净值会被同步放大。`
      : '- 行业集中度暂未明显失控，但仍需防止单一赛道在短期内快速拥挤。',
    topRegion && topRegion[1] >= 60
      ? `- 区域暴露集中在 **${topRegion[0]}**（${topRegion[1].toFixed(
          2,
        )}%），缺少跨市场缓冲。`
      : '',
    losers.length
      ? `- 近期表现偏弱的持仓包括 ${losers
          .map((x) => `**${x.name}**(${formatSignedPct(x.pctChg)})`)
          .join('、')}，建议核查这些资产是否已经偏离原有持有逻辑。`
      : '',
    topFactor && Math.abs(topFactor.value) >= 0.7
      ? `- 主要因子暴露 **${topFactor.factor}=${topFactor.value.toFixed(
          3,
        )}** 已偏单边，说明组合对单一市场风格依赖较强。`
      : '',
  ].filter(Boolean);

  const actionLines = result.rebalanceSuggestions
    .slice(0, 4)
    .map((x) => `- ${x}`);

  const monitorLines = [
    topHolding
      ? `- 若第一大持仓权重升至 **${Math.max(
          35,
          Math.round(topHolding.normalizedWeight + 5),
        )}%** 上方，建议主动再平衡，避免单一资产主导组合波动。`
      : '',
    topSector
      ? `- 若 **${topSector[0]}** 暴露持续高于 **${Math.max(
          35,
          Math.round(topSector[1]),
        )}%** 且板块相对收益转弱，应优先降集中度。`
      : '',
    topFactor
      ? `- 持续跟踪 **${topFactor.factor}** 因子对应的市场环境；若驱动方向反转，当前组合最容易先出现超额回撤。`
      : '',
    '- 若未来 1-2 周内新增观点无法落实到具体仓位调整，说明组合与研究判断仍然脱节，需要重设核心仓位与防守仓位。',
  ].filter(Boolean);

  return [
    '> 已启用规则兜底分析。',
    `> 触发原因：${reason}`,
    '',
    '## 综合结论',
    `- 当前组合风险评分为 **${result.riskScore.toFixed(1)}/100**，属于 **${riskBand}风险**。`,
    topHolding
      ? `- 组合核心仓位集中在 **${topHolding.profile.name}**，后续诊断重点应围绕“核心仓位是否值得继续做大”。`
      : '- 当前无法识别明确的核心仓位，说明组合表达仍偏分散。',
    topSector
      ? `- 当前最主要的行业暴露为 **${topSector[0]}**（${topSector[1].toFixed(2)}%）。`
      : '',
    '',
    '## 利多与机会',
    ...opportunityLines,
    '',
    '## 风险与脆弱点',
    ...riskLines,
    '',
    '## 组合动作建议（未来1-4周）',
    ...(actionLines.length
      ? actionLines
      : ['- 当前没有形成明确再平衡建议，建议先补齐目标仓位与风险上限。']),
    '',
    '## 监控清单（触发条件）',
    ...monitorLines,
  ]
    .filter(Boolean)
    .join('\n');
};

const runHomepageAgentAnalysis = async (
  input: string,
  result: PortfolioCheckResult,
  tushareDetails: TushareSecurityDetail[],
): Promise<AgentAnalysisResult> => {
  const cacheKey = createHash('sha1')
    .update(
      JSON.stringify({
        input,
        holdings: result.parsedHoldings.map((holding) => ({
          symbol: holding.symbol,
          weight: holding.normalizedWeight,
        })),
        riskScore: result.riskScore,
        factors: result.topFactorSensitivities.slice(0, 4),
        tushare: tushareDetails.slice(0, 8).map((detail) => ({
          tsCode: detail.tsCode,
          tradeDate: detail.tradeDate,
          close: detail.close,
          pctChg: detail.pctChg,
          pe: detail.pe,
          pb: detail.pb,
        })),
      }),
    )
    .digest('hex');

  const cached = readCacheEntry(agentAnalysisCache, cacheKey);
  if (cached) {
    return {
      ...cached.value,
      cacheHit: true,
    };
  }

  const registry = new ModelRegistry();
  const modelSelection = await pickDefaultChatModel(registry);
  if (!modelSelection) {
    const fallbackAnalysis = buildFallbackAgentAnalysis(
      result,
      tushareDetails,
      '未检测到可用聊天模型',
    );
    return {
      analysis: fallbackAnalysis,
      sources: [],
      providerId: '-',
      model: '-',
      mode: 'fallback',
      promptTemplateSource: 'default',
      systemPromptSource: 'default',
      cacheHit: false,
      error: 'missing chat model',
    };
  }

  const chatModel = modelSelection;

  try {
    const llm = await registry.loadChatModel(chatModel.providerId, chatModel.key);
    tunePortfolioAgentModel(llm);

    const promptPayload = buildAgentPrompt(input, result, tushareDetails);
    const systemPromptConfig = getPortfolioCheckAgentSystemPromptConfig();
    const systemPrompt =
      systemPromptConfig.value ||
      '你是资深中文投研分析师，输出应简洁、结构化、可执行。优先给结论和动作，避免长篇背景解释。';

    const res = await withTimeout(
      llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(promptPayload.prompt),
      ]),
      PORTFOLIO_AGENT_TIMEOUT_MS,
    );
    const raw = contentToText((res as any)?.content ?? '');
    const analysis =
      sanitizeLlmOutput(raw).trim() || '首页 Agent 未返回有效文本。';

    const payload: AgentAnalysisResult = {
      analysis,
      sources: [],
      providerId: chatModel.providerId,
      model: chatModel.key,
      mode: 'llm',
      promptTemplateSource: promptPayload.templateSource,
      systemPromptSource: systemPromptConfig.source as 'env' | 'config' | 'default',
      cacheHit: false,
    };
    writeCacheEntry(
      agentAnalysisCache,
      cacheKey,
      payload,
      AGENT_ANALYSIS_CACHE_TTL_MS,
      AGENT_ANALYSIS_CACHE_MAX,
    );
    return payload;
  } catch (err: any) {
    const reason = err?.message || 'agent failed';
    return {
      analysis: buildFallbackAgentAnalysis(result, tushareDetails, reason),
      sources: [],
      providerId: chatModel.providerId,
      model: chatModel.key,
      mode: 'fallback',
      promptTemplateSource: getPortfolioCheckAgentPromptTemplateConfig().source as
        | 'env'
        | 'config'
        | 'default',
      systemPromptSource: getPortfolioCheckAgentSystemPromptConfig().source as
        | 'env'
        | 'config'
        | 'default',
      cacheHit: false,
      error: reason,
    };
  }
};

const buildCombinedMarkdown = (
  baseResult: PortfolioCheckResult | null,
  tushareDetails: TushareSecurityDetail[],
  agent: AgentAnalysisResult | null,
) => {
  const sections = buildMarkdownSections(baseResult, tushareDetails, agent);
  return sections.map((s) => s.markdown.trim())
    .filter(Boolean)
    .join('\n\n');
};

const normalizeLine = (line: string) =>
  line
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const dedupeAgentMarkdown = (agentMarkdown: string, baselineMarkdown: string) => {
  const baseline = new Set(
    baselineMarkdown
      .split('\n')
      .map(normalizeLine)
      .filter((x) => x.length > 8),
  );

  const cleaned = agentMarkdown
    .split('\n')
    .filter((line) => {
      const key = normalizeLine(line);
      if (!key) return true;
      if (key.startsWith('## ')) return true;
      if (key.length <= 8) return true;
      return !baseline.has(key);
    })
    .join('\n')
    .trim();

  return cleaned || agentMarkdown.trim();
};

const buildMarkdownSections = (
  baseResult: PortfolioCheckResult | null,
  tushareDetails: TushareSecurityDetail[],
  agent: AgentAnalysisResult | null,
): MarkdownSection[] => {
  const diagnosisMarkdown = formatPortfolioCheckAsMarkdown(baseResult).trim();
  const fundActionMarkdown = formatFundActionRecommendationsMarkdown(baseResult).trim();
  const tushareMarkdown = formatTushareDetailsMarkdown(tushareDetails).trim();
  const rawAgent = (agent?.analysis || '').trim();

  const agentBody = rawAgent
    ? dedupeAgentMarkdown(rawAgent, `${diagnosisMarkdown}\n${tushareMarkdown}`)
    : '- 未执行 Agent 综合分析。';
  const agentMarkdown = [
    '## 首页 Agent 综合分析',
    '',
    agentBody,
    '',
    `> Agent模型：${agent?.providerId || '-'} / ${agent?.model || '-'}`,
  ].join('\n');

  return [
    {
      id: 'diagnosis',
      title: '基金诊断总览',
      markdown: [diagnosisMarkdown, fundActionMarkdown].filter(Boolean).join('\n\n'),
    },
    {
      id: 'tushare',
      title: 'TuShare 详细信息',
      markdown: tushareMarkdown,
    },
    {
      id: 'agent',
      title: '首页 Agent 综合分析',
      markdown: agentMarkdown,
    },
  ];
};

export const POST = async (req: Request) => {
  try {
    const body = (await req.json()) as { input?: string; holdings?: HoldingInputPayload[] };
    const totalStartedAt = Date.now();
    const fundMapStartedAt = Date.now();
    const fundMapLoaded = await ensureFundCodeMap();
    const fundMapMs = Date.now() - fundMapStartedAt;

    const fromRows = await parseHoldingPayloadRows(body?.holdings, fundMapLoaded.items);
    const input =
      fromRows.length > 0
        ? fromRows.map((x) => `${x.symbol} ${x.weight}`).join('\n')
        : String(body?.input || '').trim();
    const portfolioCheckStartedAt = Date.now();
    const rawResult = runPortfolioCheck(input);
    let result = rawResult;
    const portfolioCheckMs = Date.now() - portfolioCheckStartedAt;

    let tushareDetails: TushareSecurityDetail[] = [];
    let tushareMeta: TushareDetailCollection['meta'] = {
      requested: 0,
      cacheHits: 0,
      timeouts: 0,
      failures: 0,
    };
    let tushareMs = 0;
    if (hasTushareToken()) {
      const tushareStartedAt = Date.now();
      const tushareCollection = await collectTushareDetails(
        rawResult,
        fundMapLoaded.items,
      );
      tushareMs = Date.now() - tushareStartedAt;
      tushareDetails = tushareCollection.details;
      tushareMeta = tushareCollection.meta;
    }

    result = enrichPortfolioCheckResult(
      rawResult,
      tushareDetails,
      fundMapLoaded.items,
    );
    result = attachFundActionRecommendations(result);

    let agentAnalysis: AgentAnalysisResult | null = null;
    let agentMs = 0;
    if (result) {
      const agentStartedAt = Date.now();
      agentAnalysis = await runHomepageAgentAnalysis(input, result, tushareDetails);
      agentMs = Date.now() - agentStartedAt;
    }

    const sections = buildMarkdownSections(result, tushareDetails, agentAnalysis);
    const markdown = buildCombinedMarkdown(result, tushareDetails, agentAnalysis);
    const totalMs = Date.now() - totalStartedAt;

    console.info(
      '[portfolio-check] request timings',
      JSON.stringify({
        totalMs,
        fundMapMs,
        portfolioCheckMs,
        tushareMs,
        agentMs,
        tushareRequested: tushareMeta.requested,
        tushareCacheHits: tushareMeta.cacheHits,
        agentCacheHit: Boolean(agentAnalysis?.cacheHit),
      }),
    );

    return Response.json(
      {
        ok: true,
        result,
        tushareDetails,
        agentAnalysis: agentAnalysis?.analysis || '',
        agentMeta: agentAnalysis
          ? {
              mode: agentAnalysis.mode,
              providerId: agentAnalysis.providerId,
              model: agentAnalysis.model,
              promptTemplateSource: agentAnalysis.promptTemplateSource,
              systemPromptSource: agentAnalysis.systemPromptSource,
              error: agentAnalysis.error || '',
              sourceCount: agentAnalysis.sources.length,
              cacheHit: Boolean(agentAnalysis.cacheHit),
            }
          : null,
        sections,
        markdown,
        performance: {
          totalMs,
          fundMapMs,
          portfolioCheckMs,
          tushareMs,
          agentMs,
          tushareRequested: tushareMeta.requested,
          tushareCacheHits: tushareMeta.cacheHits,
          tushareTimeouts: tushareMeta.timeouts,
          tushareFailures: tushareMeta.failures,
          agentCacheHit: Boolean(agentAnalysis?.cacheHit),
        },
        fundMapMeta: {
          total: fundMapLoaded.items.length,
          source: fundMapLoaded.source,
          updatedAt: fundMapLoaded.updatedAt,
          cached: fundMapLoaded.cached,
          error: fundMapLoaded.error || '',
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error in /api/finance/portfolio-check:', err);
    return Response.json(
      {
        ok: false,
        message: err?.message || 'An error has occurred.',
      },
      { status: 500 },
    );
  }
};
