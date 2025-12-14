import fs from 'fs';
import path from 'node:path';
import { callTushare, hasTushareToken } from '@/lib/economy/tushare';

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
};

type EconomySummary = {
  source: string;
  market: (MarketItem & { history?: MarketHistoryPoint[] })[];
  macro: (MacroItem & { history?: MacroHistoryPoint[] })[];
  // 为首页滚动条准备的展开后的市场数据列表（至少 100 条）
  tickerMarket: MarketItem[];
};

type EconomyCache = {
  updatedAt: number;
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

// Approximate \"last month\" window for index time series
const getLastMonthStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 31);
  return formatDateYYYYMMDD(date);
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

const saveCache = (data: EconomySummary) => {
  try {
    const dir = path.dirname(ECONOMY_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cache: EconomyCache = {
      updatedAt: Date.now(),
      data,
    };
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

export const GET = async () => {
  if (!hasTushareToken()) {
    const summary: EconomySummary = {
      source: 'demo',
      market: DEMO_MARKET,
      macro: DEMO_MACRO,
      tickerMarket: DEMO_MARKET,
    };
    return Response.json(summary);
  }

  try {
    // 缓存策略：经济数据每天晚上 21:00 更新一次。
    const now = new Date();
    const cached = loadCache();
    if (cached) {
      const updatedAt = new Date(cached.updatedAt);
      const updatedDay = updatedAt.toISOString().slice(0, 10);
      const nowDay = now.toISOString().slice(0, 10);

      // 如果还是同一天，直接用缓存
      if (updatedDay === nowDay) {
        return Response.json(cached.data);
      }

      // 如果已经进入下一天，但还没到 21 点，继续使用前一天的数据
      if (now.getHours() < 21) {
        return Response.json(cached.data);
      }
    }

    const market: (MarketItem & { history?: MarketHistoryPoint[] })[] = [];
    const startDate = getLastMonthStartDate();

    // Fetch index time series for the last month for a set of indices.
    // We use index_daily, limiting by start_date, and keep both:
    // - 最新一个交易日数据
    // - 最近一个月的日度历史 (history)
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

        // Sort ascending by trade_date for a clean time series
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
          // 最近一个月的历史数据
          history,
        });
      } catch (err) {
        console.error('Failed to fetch index data from Tushare', series.id, err);
      }
    }

    // For now, macro data still uses demo placeholders (可按需扩展为真实TuShare宏观数据).
    const macro: (MacroItem & { history?: MacroHistoryPoint[] })[] =
      DEMO_MACRO.map((m) => ({
        ...m,
        // 简单标注频率与单位（示例数据，可按需对接 TuShare 宏观接口）
        history: [
          {
            period: m.period,
            value: m.value,
          },
        ],
      }));

    if (!market.length) {
      // If all Tushare calls failed, fall back completely to demo data.
      const summary: EconomySummary = {
        source: 'demo',
        market: DEMO_MARKET,
        macro: DEMO_MACRO,
        tickerMarket: DEMO_MARKET,
      };
      return Response.json(summary);
    }

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
          name: `${m.name} ${String(point.trade_date).slice(4, 8)}`, // 例如 1211
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

    // 确保经济数据条目不少于 100 条，不足则循环填充
    let tickerMarket: MarketItem[] = [...tickerMarketBase];
    const baseLen = tickerMarketBase.length;
    while (tickerMarket.length < 100 && baseLen > 0) {
      const needed = Math.min(baseLen, 100 - tickerMarket.length);
      tickerMarket = tickerMarket.concat(tickerMarketBase.slice(0, needed));
    }

    const summary: EconomySummary = {
      source: 'tushare',
      market,
      macro,
      tickerMarket,
    };

    // Cache fresh data for the next day
    saveCache(summary);

    return Response.json(summary);
  } catch (err) {
    console.error('Error in /api/economy/summary:', err);
    return Response.json({
      source: 'demo',
      market: DEMO_MARKET,
      macro: DEMO_MACRO,
      tickerMarket: DEMO_MARKET,
    });
  }
};
