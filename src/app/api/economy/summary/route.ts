import fs from 'fs';
import path from 'node:path';
import { callTushare, hasTushareToken, TushareApiError } from '@/lib/economy/tushare';
import {
  fetchStooqDaily,
  fetchTencentKlineDaily,
  fetchTreasuryYieldCurveLatest,
} from '@/lib/economy/public';

type MarketHistoryPoint = {
  trade_date: string;
  close: number;
  pct_chg: number;
};

type MarketItem = {
  id: string;
  name: string;
  region: string;
  close: number;
  pct_chg: number;
  trade_date: string;
  prev_close?: number;
  unit?: string;
  frequency?: string;
};

type MacroHistoryPoint = {
  period: string;
  value: number;
};

type MacroItem = {
  id: string;
  name: string;
  region: string;
  value: number;
  unit: string;
  period: string;
  prev_value?: number;
  prev_period?: string;
  frequency?: string;
};

type EconomySummary = {
  source: string;
  reason?: 'missing_token' | 'tushare_failed';
  error?: {
    code?: number;
    message: string;
  };
  market: (MarketItem & { history?: MarketHistoryPoint[] })[];
  macro: (MacroItem & { history?: MacroHistoryPoint[] })[];
  // 为首页滚动条准备的展开后的市场数据列表（至少 100 条）
  tickerMarket: MarketItem[];
};

type EconomyCache = {
  updatedAt: number;
  marketUpdatedAt?: number;
  macroUpdatedAt?: number;
  data: EconomySummary;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const ECONOMY_CACHE_PATH = path.join(DATA_DIR, '/data/economy-cache.json');

const formatDateYYYYMMDD = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
};

const formatMonthYYYYMM = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
};

const formatQuarterYYYYQ = (date: Date) => {
  const y = date.getFullYear();
  const month = date.getMonth() + 1;
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `${y}Q${q}`;
};

// Approximate \"last month\" window for index time series
const getLastMonthStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 31);
  return formatDateYYYYMMDD(date);
};

const formatDateYYYYMMDDDashed = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toYYYYMMDD = (date: Date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const getLast12MonthsStartMonth = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 12);
  return formatMonthYYYYMM(date);
};

const getLast8QuartersStartQuarter = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 24);
  return formatQuarterYYYYQ(date);
};

const getShanghaiDateKey = (date: Date) => {
  // YYYY-MM-DD in Asia/Shanghai
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

const isAfterShanghai21 = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .find((p) => p.type === 'hour')?.value;
  const hour = parts ? Number(parts) : 0;
  return hour >= 21;
};

const loadCache = (): EconomyCache | null => {
  try {
    if (!fs.existsSync(ECONOMY_CACHE_PATH)) return null;
    const raw = fs.readFileSync(ECONOMY_CACHE_PATH, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as EconomyCache;
    if (!parsed || typeof parsed.updatedAt !== 'number') return null;
    return parsed;
  } catch (err) {
    console.error('Failed to read economy cache file:', err);
    return null;
  }
};

const saveCache = (cache: EconomyCache) => {
  try {
    const dir = path.dirname(ECONOMY_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ECONOMY_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Failed to write economy cache file:', err);
  }
};

const DEMO_MARKET: MarketItem[] = [
  // A 股主要指数
  {
    id: '000001.SH',
    name: '上证指数',
    region: 'CN',
    close: 3000.12,
    pct_chg: 0.56,
    trade_date: '20250101',
  },
  {
    id: '399001.SZ',
    name: '深证成指',
    region: 'CN',
    close: 9500.34,
    pct_chg: -0.23,
    trade_date: '20250101',
  },
  {
    id: '399006.SZ',
    name: '创业板指',
    region: 'CN',
    close: 2200.78,
    pct_chg: 1.02,
    trade_date: '20250101',
  },
  {
    id: '000300.SH',
    name: '沪深300',
    region: 'CN',
    close: 3800.56,
    pct_chg: 0.34,
    trade_date: '20250101',
  },
  {
    id: '000905.SH',
    name: '中证500',
    region: 'CN',
    close: 6500.43,
    pct_chg: -0.41,
    trade_date: '20250101',
  },
  // 港股
  {
    id: 'HSI.HI',
    name: '恒生指数',
    region: 'HK',
    close: 19500.21,
    pct_chg: 0.85,
    trade_date: '20250101',
  },
  // 美股
  {
    id: 'DJI',
    name: '道琼斯工业指数',
    region: 'US',
    close: 39500.11,
    pct_chg: -0.15,
    trade_date: '20250101',
  },
  {
    id: 'IXIC',
    name: '纳斯达克综合',
    region: 'US',
    close: 16500.98,
    pct_chg: 0.67,
    trade_date: '20250101',
  },
  {
    id: 'SPX',
    name: '标普500',
    region: 'US',
    close: 5200.45,
    pct_chg: 0.12,
    trade_date: '20250101',
  },
];

const DEMO_MACRO: MacroItem[] = [
  {
    id: 'CN_CPI',
    name: '中国CPI同比',
    region: 'CN',
    value: 2.1,
    unit: '%',
    period: '2024-12',
  },
  {
    id: 'CN_PPI',
    name: '中国PPI同比',
    region: 'CN',
    value: -0.5,
    unit: '%',
    period: '2024-12',
  },
  {
    id: 'CN_GDP',
    name: '中国GDP增速',
    region: 'CN',
    value: 5.3,
    unit: '%',
    period: '2024-Q4',
  },
  {
    id: 'US_CPI',
    name: '美国CPI同比',
    region: 'US',
    value: 3.1,
    unit: '%',
    period: '2024-12',
  },
  {
    id: 'EU_CPI',
    name: '欧元区CPI同比',
    region: 'EU',
    value: 2.4,
    unit: '%',
    period: '2024-12',
  },
  {
    id: 'US_FED_FUNDS',
    name: '美国联邦基金利率',
    region: 'US',
    value: 4.75,
    unit: '%',
    period: '2024-12',
  },
  {
    id: 'CN_10Y_YIELD',
    name: '中国10年国债收益率',
    region: 'CN',
    value: 2.6,
    unit: '%',
    period: '2024-12',
  },
  {
    id: 'US_10Y_YIELD',
    name: '美国10年国债收益率',
    region: 'US',
    value: 4.1,
    unit: '%',
    period: '2024-12',
  },
];

const INDEX_SERIES = [
  { id: '000001.SH', name: '上证指数', region: 'CN' },
  { id: '399001.SZ', name: '深证成指', region: 'CN' },
  { id: '399006.SZ', name: '创业板指', region: 'CN' },
  { id: '000300.SH', name: '沪深300', region: 'CN' },
  { id: '000905.SH', name: '中证500', region: 'CN' },
  { id: '000016.SH', name: '上证50', region: 'CN' },
  { id: '000688.SH', name: '科创50', region: 'CN' },
  { id: '399005.SZ', name: '中小板指', region: 'CN' },
  { id: '399673.SZ', name: '创业板50', region: 'CN' },
  { id: '399300.SZ', name: '沪深300(深证)', region: 'CN' },
];

const buildTickerMarketFromHistory = (
  market: (MarketItem & { history?: MarketHistoryPoint[] })[],
) => {
  const tickerMarketBase: MarketItem[] = [];
  const takeDays = 5;
  for (const m of market) {
    const history = m.history ?? [];
    if (!history.length) continue;

    const len = history.length;
    const startIdx = Math.max(0, len - takeDays);

    for (let i = startIdx; i < len; i++) {
      const point = history[i];
      const prevPoint = i > 0 ? history[i - 1] : point;

      tickerMarketBase.push({
        id: `${m.id}-${point.trade_date}`,
        name: `${m.name} ${String(point.trade_date).slice(4, 8)}`,
        region: m.region,
        close: point.close,
        pct_chg: point.pct_chg,
        trade_date: point.trade_date,
        prev_close: prevPoint.close,
        unit: m.unit,
        frequency: m.frequency,
      });
    }
  }

  let nextTickerMarket: MarketItem[] = [...tickerMarketBase];
  const baseLen = tickerMarketBase.length;
  while (nextTickerMarket.length < 100 && baseLen > 0) {
    const needed = Math.min(baseLen, 100 - nextTickerMarket.length);
    nextTickerMarket = nextTickerMarket.concat(
      tickerMarketBase.slice(0, needed),
    );
  }
  return nextTickerMarket;
};

const getPublicEconomySummary = async (opts?: {
  reason?: EconomySummary['reason'];
  error?: EconomySummary['error'];
}): Promise<EconomySummary> => {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 31);
  const d1 = toYYYYMMDD(from);
  const d2 = toYYYYMMDD(now);

  const marketSeries = [
    // CN indices (Tencent Kline)
    { id: 'sh000001', name: '上证指数', region: 'CN', kind: 'tencent' as const },
    { id: 'sz399001', name: '深证成指', region: 'CN', kind: 'tencent' as const },
    { id: 'sz399006', name: '创业板指', region: 'CN', kind: 'tencent' as const },
    { id: 'sh000300', name: '沪深300', region: 'CN', kind: 'tencent' as const },
    // Global indices (Stooq)
    { id: '^spx', name: 'S&P 500', region: 'US', kind: 'stooq' as const },
    { id: '^ndx', name: 'NASDAQ 100', region: 'US', kind: 'stooq' as const },
    { id: '^dji', name: '道琼斯工业指数', region: 'US', kind: 'stooq' as const },
    { id: '^hsi', name: '恒生指数', region: 'HK', kind: 'stooq' as const },
    { id: '^nkx', name: '日经225', region: 'JP', kind: 'stooq' as const },
    { id: '^dax', name: '德国DAX', region: 'EU', kind: 'stooq' as const },
    { id: '^cac', name: '法国CAC40', region: 'EU', kind: 'stooq' as const },
    { id: '^ukx', name: '英国FTSE 100', region: 'EU', kind: 'stooq' as const },
  ];

  const market: (MarketItem & { history?: MarketHistoryPoint[] })[] = [];

  for (const s of marketSeries) {
    try {
      if (s.kind === 'stooq') {
        const rows = await fetchStooqDaily(s.id, {
          fromYYYYMMDD: d1,
          toYYYYMMDD: d2,
        });
        if (rows.length < 2) continue;
        rows.sort((a, b) => a.date.localeCompare(b.date));
        const latest = rows[rows.length - 1];
        const prev = rows[rows.length - 2];
        const pct = prev.close
          ? ((latest.close - prev.close) / prev.close) * 100
          : 0;

        market.push({
          id: s.id,
          name: s.name,
          region: s.region,
          close: latest.close,
          pct_chg: pct,
          trade_date: latest.date.replace(/-/g, ''),
          unit: '点',
          frequency: '日度',
          history: rows.map((r, idx) => ({
            trade_date: r.date.replace(/-/g, ''),
            close: r.close,
            pct_chg:
              idx === 0 || rows[idx - 1].close === 0
                ? 0
                : ((r.close - rows[idx - 1].close) / rows[idx - 1].close) *
                  100,
          })),
        });
      } else {
        const rows = await fetchTencentKlineDaily(s.id, 60);
        if (rows.length < 2) continue;
        rows.sort((a, b) => a.date.localeCompare(b.date));
        const latest = rows[rows.length - 1];

        market.push({
          id: s.id,
          name: s.name,
          region: s.region,
          close: latest.close,
          pct_chg: latest.pct_chg,
          trade_date: latest.date.replace(/-/g, ''),
          unit: '点',
          frequency: '日度',
          history: rows.map((r) => ({
            trade_date: r.date.replace(/-/g, ''),
            close: r.close,
            pct_chg: r.pct_chg,
          })),
        });
      }
    } catch (err) {
      console.error('Public market fetch failed:', s.id, err);
    }
  }

  const { latest: ycLatest, prev: ycPrev } =
    await fetchTreasuryYieldCurveLatest().catch((err) => {
      console.error('Treasury yield fetch failed', err);
      return { latest: undefined, prev: undefined };
    });

  const cached = loadCache();
  const cachedMacro = (cached?.data?.macro as any[]) ?? [];
  const findPrev = (id: string) => {
    const hit = cachedMacro.find((m) => m?.id === id);
    return hit
      ? {
          value: Number(hit?.value),
          period: String(hit?.period ?? ''),
        }
      : undefined;
  };

  const macro: (MacroItem & { history?: MacroHistoryPoint[] })[] = [];

  if (ycLatest?.y10 !== undefined) {
    macro.push({
      id: 'US_10Y_YIELD',
      name: '美国10年国债收益率',
      region: 'US',
      value: ycLatest.y10,
      unit: '%',
      period: ycLatest.date,
      prev_value: ycPrev?.y10,
      prev_period: ycPrev?.date,
      frequency: '日度',
      history: [
        { period: ycLatest.date, value: ycLatest.y10 },
        ...(ycPrev?.y10 !== undefined
          ? [{ period: ycPrev.date, value: ycPrev.y10 }]
          : []),
      ],
    });
  }
  if (ycLatest?.y2 !== undefined) {
    macro.push({
      id: 'US_2Y_YIELD',
      name: '美国2年国债收益率',
      region: 'US',
      value: ycLatest.y2,
      unit: '%',
      period: ycLatest.date,
      prev_value: ycPrev?.y2,
      prev_period: ycPrev?.date,
      frequency: '日度',
      history: [
        { period: ycLatest.date, value: ycLatest.y2 },
        ...(ycPrev?.y2 !== undefined
          ? [{ period: ycPrev.date, value: ycPrev.y2 }]
          : []),
      ],
    });
  }

  // FX (no-key API) + prev from cache
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cache: 'no-store',
    });
    const json = (await res.json()) as any;
    const rates = json?.rates ?? {};

    const addFx = (id: string, name: string, unit: string, value: number) => {
      const prev = findPrev(id);
      macro.push({
        id,
        name,
        region: 'FX',
        value,
        unit,
        period: formatDateYYYYMMDDDashed(now),
        prev_value:
          prev && Number.isFinite(prev.value) ? (prev.value as number) : undefined,
        prev_period: prev?.period || undefined,
        frequency: '日度',
      });
    };

    if (typeof rates.CNY === 'number') addFx('USD_CNY', '美元/人民币', 'CNY', rates.CNY);
    if (typeof rates.JPY === 'number') addFx('USD_JPY', '美元/日元', 'JPY', rates.JPY);
    if (typeof rates.EUR === 'number' && rates.EUR !== 0) {
      addFx('EUR_USD', '欧元/美元', 'USD', 1 / rates.EUR);
    }
  } catch (err) {
    console.error('FX fetch failed', err);
  }

  const tickerMarket = buildTickerMarketFromHistory(market);

  return {
    source: 'public',
    reason: opts?.reason,
    error: opts?.error,
    market,
    macro,
    tickerMarket,
  };
};

export const GET = async () => {
  if (!hasTushareToken()) {
    const summary = await getPublicEconomySummary({ reason: 'missing_token' });
    return Response.json(summary);
  }

  try {
    const now = new Date();
    const cached = loadCache();

    // 缓存策略：
    // - 市场数据：每 10 分钟刷新一次（滚动条要求）
    // - 宏观经济：每天上海时间 21:00 后刷新一次（若太久未刷新也会补刷）
    const MARKET_TTL_MS = 10 * 60 * 1000;
    const FORCE_REFRESH = false;

    const cachedMarketUpdatedAt =
      cached?.marketUpdatedAt ?? cached?.updatedAt ?? 0;
    const cachedMacroUpdatedAt = cached?.macroUpdatedAt ?? cached?.updatedAt ?? 0;

    const marketFresh =
      cached && cachedMarketUpdatedAt && Date.now() - cachedMarketUpdatedAt < MARKET_TTL_MS;

    const nowShanghaiDay = getShanghaiDateKey(now);
    const macroShanghaiDay = cachedMacroUpdatedAt
      ? getShanghaiDateKey(new Date(cachedMacroUpdatedAt))
      : '';

    const macroTooOld =
      !cachedMacroUpdatedAt || Date.now() - cachedMacroUpdatedAt > 36 * 60 * 60 * 1000;
    const macroNeedsRefresh =
      !cached ||
      macroTooOld ||
      (isAfterShanghai21(now) && macroShanghaiDay !== nowShanghaiDay);

    if (cached && marketFresh && !macroNeedsRefresh && !FORCE_REFRESH) {
      return Response.json(cached.data);
    }

    let market: (MarketItem & { history?: MarketHistoryPoint[] })[] =
      cached?.data.market ?? [];
    let tickerMarket: MarketItem[] = cached?.data.tickerMarket ?? [];
    let macro: (MacroItem & { history?: MacroHistoryPoint[] })[] =
      (cached?.data.macro as any) ?? [];

    let marketUpdatedAt = cachedMarketUpdatedAt || 0;
    let macroUpdatedAt = cachedMacroUpdatedAt || 0;

    const startDate = getLastMonthStartDate();

    // 市场数据：若缓存过期，则从 TuShare 拉取最新（并带最近一个月历史）
    let lastTushareError: { code?: number; message: string } | undefined;

    if (!marketFresh || FORCE_REFRESH || !market.length) {
      market = [];

      for (const series of INDEX_SERIES) {
        try {
          const rows = await callTushare(
            'index_daily',
            {
              ts_code: series.id,
              start_date: startDate,
            },
            ['ts_code', 'trade_date', 'close', 'pct_chg'],
          );

          if (!rows.length) continue;

          rows.sort((a, b) =>
            String(a.trade_date).localeCompare(String(b.trade_date)),
          );
          const latest = rows[rows.length - 1];

          const close = Number(latest.close ?? 0);
          const pctChg = Number(latest.pct_chg ?? 0);

          const history: MarketHistoryPoint[] = rows.map((row) => ({
            trade_date: String(row.trade_date ?? ''),
            close: Number(row.close ?? 0),
            pct_chg: Number(row.pct_chg ?? 0),
          }));

          market.push({
            id: series.id,
            name: series.name,
            region: series.region,
            close,
            pct_chg: pctChg,
            trade_date: String(latest.trade_date ?? ''),
            frequency: '日度',
            unit: '点',
            history,
          });
        } catch (err) {
          if (err instanceof TushareApiError) {
            lastTushareError = { code: err.code, message: err.msg };
          } else if (err instanceof Error) {
            lastTushareError = { message: err.message };
          } else {
            lastTushareError = { message: 'Unknown error' };
          }
          console.error(
            'Failed to fetch index data from Tushare',
            series.id,
            err,
          );
        }
      }

      marketUpdatedAt = Date.now();

      // 为滚动条构造更丰富的市场数据：每个指数取最近 5 个交易日
      const tickerMarketBase: MarketItem[] = [];
      const takeDays = 5;

      for (const m of market) {
        const history = m.history ?? [];
        if (!history.length) continue;

        const len = history.length;
        const startIdx = Math.max(0, len - takeDays);

        for (let i = startIdx; i < len; i++) {
          const point = history[i];
          const prevPoint = i > 0 ? history[i - 1] : point;

          tickerMarketBase.push({
            id: `${m.id}-${point.trade_date}`,
            name: `${m.name} ${String(point.trade_date).slice(4, 8)}`,
            region: m.region,
            close: point.close,
            pct_chg: point.pct_chg,
            trade_date: point.trade_date,
            prev_close: prevPoint.close,
            unit: '点',
            frequency: '日度',
          });
        }
      }

      let nextTickerMarket: MarketItem[] = [...tickerMarketBase];
      const baseLen = tickerMarketBase.length;
      while (nextTickerMarket.length < 100 && baseLen > 0) {
        const needed = Math.min(baseLen, 100 - nextTickerMarket.length);
        nextTickerMarket = nextTickerMarket.concat(
          tickerMarketBase.slice(0, needed),
        );
      }

      tickerMarket = nextTickerMarket;
    }

    // 宏观经济：每天上海时间 21:00 更新一次
    if (macroNeedsRefresh || FORCE_REFRESH || !macro.length) {
      const monthStart = getLast12MonthsStartMonth();
      const monthEnd = formatMonthYYYYMM(now);
      const qStart = getLast8QuartersStartQuarter();
      const qEnd = formatQuarterYYYYQ(now);

      const toNum = (v: any) => (v === null || v === undefined ? NaN : Number(v));
      const formatMonth = (m: string) =>
        m && m.length === 6 ? `${m.slice(0, 4)}-${m.slice(4, 6)}` : m;

      const formatQuarter = (q: string) => q;

      const pickLatestPair = <T extends Record<string, any>>(
        rows: T[],
        key: keyof T,
      ) => {
        const sorted = [...rows].sort((a, b) =>
          String(a[key]).localeCompare(String(b[key])),
        );
        const latest = sorted[sorted.length - 1];
        const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : undefined;
        return { latest, prev };
      };

      const macroItems: MacroItem[] = [];

      // Shibor（日度利率）
      try {
        const startDate = getLastMonthStartDate();
        const endDate = formatDateYYYYMMDD(now);
        const rows = await callTushare(
          'shibor',
          { start_date: startDate, end_date: endDate },
          ['date', 'on', '1w', '1m', '3m', '6m', '1y'],
        );
        if (rows.length) {
          const { latest, prev } = pickLatestPair(rows, 'date');
          const date = String(latest.date ?? '');
          const prevDate = prev ? String(prev.date ?? '') : undefined;

          const shiborFields: { key: string; name: string }[] = [
            { key: 'on', name: 'Shibor 隔夜' },
            { key: '1w', name: 'Shibor 1周' },
            { key: '1m', name: 'Shibor 1月' },
            { key: '3m', name: 'Shibor 3月' },
            { key: '1y', name: 'Shibor 1年' },
          ];

          for (const f of shiborFields) {
            const value = toNum((latest as any)[f.key]);
            if (Number.isNaN(value)) continue;
            const prevValue = prev ? toNum((prev as any)[f.key]) : undefined;
            macroItems.push({
              id: `SHIBOR_${f.key}`,
              name: f.name,
              region: 'CN',
              value,
              unit: '%',
              period: date,
              prev_value: Number.isNaN(prevValue as any) ? undefined : prevValue,
              prev_period: prevDate,
              frequency: '日度',
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch shibor from Tushare', err);
      }

      // LPR（月度利率）
      try {
        const startDate = getLastMonthStartDate();
        const endDate = formatDateYYYYMMDD(now);
        const rows = await callTushare(
          'lpr',
          { start_date: startDate, end_date: endDate },
          ['date', '1y', '5y'],
        );
        if (rows.length) {
          const { latest, prev } = pickLatestPair(rows, 'date');
          const date = String(latest.date ?? '');
          const prevDate = prev ? String(prev.date ?? '') : undefined;

          const lprFields: { key: string; name: string }[] = [
            { key: '1y', name: 'LPR 1年' },
            { key: '5y', name: 'LPR 5年' },
          ];

          for (const f of lprFields) {
            const value = toNum((latest as any)[f.key]);
            if (Number.isNaN(value)) continue;
            const prevValue = prev ? toNum((prev as any)[f.key]) : undefined;
            macroItems.push({
              id: `LPR_${f.key}`,
              name: f.name,
              region: 'CN',
              value,
              unit: '%',
              period: date,
              prev_value: Number.isNaN(prevValue as any) ? undefined : prevValue,
              prev_period: prevDate,
              frequency: '月度',
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch lpr from Tushare', err);
      }

      // CPI（同比，月度）
      try {
        const rows = await callTushare(
          'cn_cpi',
          { start_m: monthStart, end_m: monthEnd },
          ['month', 'nt_yoy'],
        );
        if (rows.length) {
          const { latest, prev } = pickLatestPair(rows, 'month');
          const month = String(latest.month ?? '');
          const prevMonth = prev ? String(prev.month ?? '') : undefined;
          const value = toNum((latest as any).nt_yoy);
          if (!Number.isNaN(value)) {
            const prevValue = prev ? toNum((prev as any).nt_yoy) : undefined;
            macroItems.push({
              id: 'CN_CPI_YOY',
              name: '中国CPI同比',
              region: 'CN',
              value,
              unit: '%',
              period: formatMonth(month),
              prev_value: Number.isNaN(prevValue as any) ? undefined : prevValue,
              prev_period: prevMonth ? formatMonth(prevMonth) : undefined,
              frequency: '月度',
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch cn_cpi from Tushare', err);
      }

      // PPI（同比，月度）
      try {
        const rows = await callTushare(
          'cn_ppi',
          { start_m: monthStart, end_m: monthEnd },
          ['month', 'ppi_yoy'],
        );
        if (rows.length) {
          const { latest, prev } = pickLatestPair(rows, 'month');
          const month = String(latest.month ?? '');
          const prevMonth = prev ? String(prev.month ?? '') : undefined;
          const value = toNum((latest as any).ppi_yoy);
          if (!Number.isNaN(value)) {
            const prevValue = prev ? toNum((prev as any).ppi_yoy) : undefined;
            macroItems.push({
              id: 'CN_PPI_YOY',
              name: '中国PPI同比',
              region: 'CN',
              value,
              unit: '%',
              period: formatMonth(month),
              prev_value: Number.isNaN(prevValue as any) ? undefined : prevValue,
              prev_period: prevMonth ? formatMonth(prevMonth) : undefined,
              frequency: '月度',
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch cn_ppi from Tushare', err);
      }

      // 货币供应量 M2（同比，月度）
      try {
        const rows = await callTushare(
          'cn_m',
          { start_m: monthStart, end_m: monthEnd },
          ['month', 'm2_yoy'],
        );
        if (rows.length) {
          const { latest, prev } = pickLatestPair(rows, 'month');
          const month = String(latest.month ?? '');
          const prevMonth = prev ? String(prev.month ?? '') : undefined;
          const value = toNum((latest as any).m2_yoy);
          if (!Number.isNaN(value)) {
            const prevValue = prev ? toNum((prev as any).m2_yoy) : undefined;
            macroItems.push({
              id: 'CN_M2_YOY',
              name: '中国M2同比',
              region: 'CN',
              value,
              unit: '%',
              period: formatMonth(month),
              prev_value: Number.isNaN(prevValue as any) ? undefined : prevValue,
              prev_period: prevMonth ? formatMonth(prevMonth) : undefined,
              frequency: '月度',
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch cn_m from Tushare', err);
      }

      // GDP（季度，同比）
      try {
        const rows = await callTushare(
          'cn_gdp',
          { start_q: qStart, end_q: qEnd },
          ['quarter', 'gdp_yoy'],
        );
        if (rows.length) {
          const { latest, prev } = pickLatestPair(rows, 'quarter');
          const quarter = String((latest as any).quarter ?? '');
          const prevQuarter = prev ? String((prev as any).quarter ?? '') : undefined;
          const value = toNum((latest as any).gdp_yoy);
          if (!Number.isNaN(value)) {
            const prevValue = prev ? toNum((prev as any).gdp_yoy) : undefined;
            macroItems.push({
              id: 'CN_GDP_YOY',
              name: '中国GDP同比',
              region: 'CN',
              value,
              unit: '%',
              period: formatQuarter(quarter),
              prev_value: Number.isNaN(prevValue as any) ? undefined : prevValue,
              prev_period: prevQuarter ? formatQuarter(prevQuarter) : undefined,
              frequency: '季度',
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch cn_gdp from Tushare', err);
      }

      // 若宏观接口不可用，则回退到示例数据（但保留单位/频率）
      macro =
        macroItems.length > 0
          ? macroItems.map((m) => ({
              ...m,
              history: [
                {
                  period: m.period,
                  value: m.value,
                },
              ],
            }))
          : DEMO_MACRO.map((m) => ({
              ...m,
              frequency: '月度/季度',
              history: [
                {
                  period: m.period,
                  value: m.value,
                },
              ],
            }));

      macroUpdatedAt = Date.now();
    }

    if (!market.length) {
      const summary = await getPublicEconomySummary({
        reason: 'tushare_failed',
        error:
          lastTushareError ?? {
            message: 'Tushare calls failed. Please verify token permissions.',
          },
      });
      return Response.json(summary);
    }

    const summary: EconomySummary = {
      source: 'tushare',
      market,
      macro,
      tickerMarket,
    };

    const shouldWriteCache =
      !cached ||
      marketUpdatedAt !== cachedMarketUpdatedAt ||
      macroUpdatedAt !== cachedMacroUpdatedAt;

    if (shouldWriteCache) {
      saveCache({
        updatedAt: Date.now(),
        marketUpdatedAt,
        macroUpdatedAt,
        data: summary,
      });
    }

    return Response.json(summary);
  } catch (err) {
    console.error('Error in /api/economy/summary:', err);
    const summary = await getPublicEconomySummary({
      reason: 'tushare_failed',
      error: { message: 'Economy endpoint failed, falling back to public data.' },
    });
    return Response.json(summary);
  }
};
