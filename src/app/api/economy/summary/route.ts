import fs from 'fs';
import path from 'node:path';
import { callTushare, hasTushareToken, TushareApiError } from '@/lib/economy/tushare';
import {
  fetchStooqDaily,
  fetchTencentKlineDaily,
  fetchCboeVixDaily,
  fetchWorldBankIndicatorLatest,
  fetchErApiUsdLatest,
  fetchFredLatest,
  fetchLprLatest,
  fetchNbsLatest,
  fetchShiborLatest,
  fetchChinaBond10yLatest,
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

type WorldBankIndicatorConfig = {
  id: string;
  name: string;
  region: string;
  country: string;
  indicator: string;
  unit: string;
  frequency: string;
  scale?: number;
};

type WorldBankIndicatorDef = {
  key: string;
  name: string;
  indicator: string;
  unit: string;
  frequency: string;
  scale?: number;
};

const fetchWorldBankMacroItems = async (): Promise<
  (MacroItem & { history?: MacroHistoryPoint[] })[]
> => {
  const buildWbConfigs = (
    label: string,
    region: string,
    country: string,
    defs: WorldBankIndicatorDef[],
  ): WorldBankIndicatorConfig[] =>
    defs.map((d) => ({
      id: `WB_${region}_${d.key}`,
      name: `${label}${d.name}`,
      region,
      country,
      indicator: d.indicator,
      unit: d.unit,
      frequency: d.frequency,
      scale: d.scale,
    }));

  const countryDefs: WorldBankIndicatorDef[] = [
    { key: 'GDP_CURRENT', name: 'GDP(现价)', indicator: 'NY.GDP.MKTP.CD', unit: '万亿美元', frequency: '年度', scale: 1e12 },
    { key: 'GDP_GROWTH', name: 'GDP增速', indicator: 'NY.GDP.MKTP.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'GDP_PER_CAPITA', name: '人均GDP', indicator: 'NY.GDP.PCAP.CD', unit: '千美元', frequency: '年度', scale: 1e3 },
    { key: 'GDP_PC_GROWTH', name: '人均GDP增速', indicator: 'NY.GDP.PCAP.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'GDP_DEFLATOR', name: 'GDP平减指数(通胀)', indicator: 'NY.GDP.DEFL.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'CPI_INFLATION', name: '通胀(CPI)', indicator: 'FP.CPI.TOTL.ZG', unit: '%', frequency: '年度' },
    { key: 'UNEMPLOY', name: '失业率', indicator: 'SL.UEM.TOTL.ZS', unit: '%', frequency: '年度' },
    { key: 'LABOR_PART', name: '劳参率', indicator: 'SL.TLF.CACT.ZS', unit: '%', frequency: '年度' },
    { key: 'EMPLOY_RATIO', name: '就业人口比', indicator: 'SL.EMP.TOTL.SP.ZS', unit: '%', frequency: '年度' },
    { key: 'POP', name: '人口', indicator: 'SP.POP.TOTL', unit: '亿人', frequency: '年度', scale: 1e8 },
    { key: 'POP_GROWTH', name: '人口增速', indicator: 'SP.POP.GROW', unit: '%', frequency: '年度' },
    { key: 'LIFE_EXPECT', name: '预期寿命', indicator: 'SP.DYN.LE00.IN', unit: '岁', frequency: '年度' },
    { key: 'URBAN_RATE', name: '城镇化率', indicator: 'SP.URB.TOTL.IN.ZS', unit: '%', frequency: '年度' },
    { key: 'DEBT_GDP', name: '政府债务/ GDP', indicator: 'GC.DOD.TOTL.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'TAX_GDP', name: '税收/ GDP', indicator: 'GC.TAX.TOTL.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'EXPENSE_GDP', name: '政府支出/ GDP', indicator: 'GC.XPN.TOTL.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'SAVINGS_GDP', name: '总储蓄/ GDP', indicator: 'NY.GNS.ICTR.ZS', unit: '%', frequency: '年度' },
    { key: 'CAPITAL_FORM_GDP', name: '资本形成/ GDP', indicator: 'NE.GDI.FTOT.ZS', unit: '%', frequency: '年度' },
    { key: 'TRADE_GDP', name: '贸易额/ GDP', indicator: 'NE.TRD.GNFS.ZS', unit: '%', frequency: '年度' },
    { key: 'EXPORT_GDP', name: '出口/ GDP', indicator: 'NE.EXP.GNFS.ZS', unit: '%', frequency: '年度' },
    { key: 'IMPORT_GDP', name: '进口/ GDP', indicator: 'NE.IMP.GNFS.ZS', unit: '%', frequency: '年度' },
    { key: 'EXPORT_USD', name: '出口额', indicator: 'NE.EXP.GNFS.CD', unit: '十亿美元', frequency: '年度', scale: 1e9 },
    { key: 'IMPORT_USD', name: '进口额', indicator: 'NE.IMP.GNFS.CD', unit: '十亿美元', frequency: '年度', scale: 1e9 },
    { key: 'EXPORT_GROWTH', name: '出口增速(量)', indicator: 'NE.EXP.GNFS.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'IMPORT_GROWTH', name: '进口增速(量)', indicator: 'NE.IMP.GNFS.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'FDI_IN_GDP', name: 'FDI净流入/ GDP', indicator: 'BX.KLT.DINV.WD.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'FDI_OUT_GDP', name: 'FDI净流出/ GDP', indicator: 'BM.KLT.DINV.WD.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'RESERVES_USD', name: '外汇储备(含黄金)', indicator: 'FI.RES.TOTL.CD', unit: '亿美元', frequency: '年度', scale: 1e8 },
    { key: 'RESERVES_MONTHS', name: '外汇储备(月进口)', indicator: 'FI.RES.XGLD.MO', unit: '月', frequency: '年度' },
    { key: 'CA_USD', name: '经常账户余额', indicator: 'BN.CAB.XOKA.CD', unit: '亿美元', frequency: '年度', scale: 1e8 },
    { key: 'CA_GDP', name: '经常账户/ GDP', indicator: 'BN.CAB.XOKA.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'CREDIT_PRIVATE_GDP', name: '私营部门信贷/ GDP', indicator: 'FS.AST.PRVT.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'CREDIT_FIN_GDP', name: '金融部门信贷/ GDP', indicator: 'FS.AST.DOMS.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'MONEY_GDP', name: '广义货币/ GDP', indicator: 'FM.LBL.BMNY.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'REAL_RATE', name: '实际利率', indicator: 'FR.INR.RINR', unit: '%', frequency: '年度' },
    { key: 'LEND_RATE', name: '贷款利率', indicator: 'FR.INR.LEND', unit: '%', frequency: '年度' },
    { key: 'DEPOSIT_RATE', name: '存款利率', indicator: 'FR.INR.DPST', unit: '%', frequency: '年度' },
    { key: 'FX_RATE', name: '官方汇率(本币/美元)', indicator: 'PA.NUS.FCRF', unit: '本币/美元', frequency: '年度' },
    { key: 'AGRI_SHARE', name: '农业占比', indicator: 'NV.AGR.TOTL.ZS', unit: '%', frequency: '年度' },
    { key: 'INDUSTRY_SHARE', name: '工业占比', indicator: 'NV.IND.TOTL.ZS', unit: '%', frequency: '年度' },
    { key: 'MANUF_SHARE', name: '制造业占比', indicator: 'NV.IND.MANF.ZS', unit: '%', frequency: '年度' },
    { key: 'SERVICES_SHARE', name: '服务业占比', indicator: 'NV.SRV.TETC.ZS', unit: '%', frequency: '年度' },
  ];

  const worldDefs: WorldBankIndicatorDef[] = [
    { key: 'GDP_CURRENT', name: 'GDP(现价)', indicator: 'NY.GDP.MKTP.CD', unit: '万亿美元', frequency: '年度', scale: 1e12 },
    { key: 'GDP_GROWTH', name: 'GDP增速', indicator: 'NY.GDP.MKTP.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'GDP_PER_CAPITA', name: '人均GDP', indicator: 'NY.GDP.PCAP.CD', unit: '千美元', frequency: '年度', scale: 1e3 },
    { key: 'GDP_PC_GROWTH', name: '人均GDP增速', indicator: 'NY.GDP.PCAP.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'GDP_DEFLATOR', name: 'GDP平减指数(通胀)', indicator: 'NY.GDP.DEFL.KD.ZG', unit: '%', frequency: '年度' },
    { key: 'CPI_INFLATION', name: '通胀(CPI)', indicator: 'FP.CPI.TOTL.ZG', unit: '%', frequency: '年度' },
    { key: 'POP', name: '人口', indicator: 'SP.POP.TOTL', unit: '亿人', frequency: '年度', scale: 1e8 },
    { key: 'POP_GROWTH', name: '人口增速', indicator: 'SP.POP.GROW', unit: '%', frequency: '年度' },
    { key: 'TRADE_GDP', name: '贸易额/ GDP', indicator: 'NE.TRD.GNFS.ZS', unit: '%', frequency: '年度' },
    { key: 'FDI_IN_GDP', name: 'FDI净流入/ GDP', indicator: 'BX.KLT.DINV.WD.GD.ZS', unit: '%', frequency: '年度' },
    { key: 'SAVINGS_GDP', name: '总储蓄/ GDP', indicator: 'NY.GNS.ICTR.ZS', unit: '%', frequency: '年度' },
    { key: 'CAPITAL_FORM_GDP', name: '资本形成/ GDP', indicator: 'NE.GDI.FTOT.ZS', unit: '%', frequency: '年度' },
  ];

  const configs: WorldBankIndicatorConfig[] = [
    ...buildWbConfigs('美国', 'US', 'USA', countryDefs),
    ...buildWbConfigs('中国', 'CN', 'CHN', countryDefs),
    ...buildWbConfigs('日本', 'JP', 'JPN', countryDefs),
    ...buildWbConfigs('欧元区', 'EU', 'EMU', countryDefs),
    ...buildWbConfigs('全球', 'WLD', 'WLD', worldDefs),
  ];

  const concurrency = 8;
  const out: (MacroItem & { history?: MacroHistoryPoint[] })[] = [];
  let cursor = 0;

  const workers = Array.from({ length: concurrency }).map(async () => {
    while (cursor < configs.length) {
      const cfg = configs[cursor];
      cursor += 1;
      if (!cfg) continue;

      try {
        const { latest, prev } = await fetchWorldBankIndicatorLatest(
          cfg.country,
          cfg.indicator,
        );
        if (!latest) continue;

        const scale = cfg.scale ?? 1;
        const value = latest.value / scale;
        const prevValue = prev ? prev.value / scale : undefined;

        out.push({
          id: cfg.id,
          name: cfg.name,
          region: cfg.region,
          value,
          unit: cfg.unit,
          period: latest.date,
          prev_value: prevValue,
          prev_period: prev?.date,
          frequency: cfg.frequency,
          history: [
            { period: latest.date, value },
            ...(prev ? [{ period: prev.date, value: prevValue! }] : []),
          ],
        });
      } catch (err) {
        console.error('WorldBank fetch failed:', cfg.id, err);
      }
    }
  });

  await Promise.all(workers);
  out.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
  return out;
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
    // Volatility index (CBOE)
    { id: 'VIX', name: 'VIX恐慌指数', region: 'US', kind: 'cboe_vix' as const },
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
      } else if (s.kind === 'cboe_vix') {
        const rows = await fetchCboeVixDaily({
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

  // China macro (NBS)
  const nbs = await Promise.allSettled([
    fetchNbsLatest({ dbcode: 'hgyd', cn: 'A01', zb: 'A01010G01' }), // CPI YoY index (2021-)
    fetchNbsLatest({ dbcode: 'hgyd', cn: 'A01', zb: 'A01080101' }), // PPI YoY index
    fetchNbsLatest({ dbcode: 'hgyd', cn: 'A0B', zb: 'A0B0101' }), // PMI manufacturing
    fetchNbsLatest({ dbcode: 'hgyd', cn: 'A0B', zb: 'A0B0201' }), // PMI non-manufacturing
    fetchNbsLatest({ dbcode: 'hgyd', cn: 'A0B', zb: 'A0B0301' }), // PMI composite
    fetchNbsLatest({ dbcode: 'hgyd', cn: 'A0D', zb: 'A0D0102' }), // M2 YoY
    fetchNbsLatest({ dbcode: 'hgjd', cn: 'A01', zb: 'A0103' }), // GDP index (YoY, base=100)
  ]);

  const pick = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === 'fulfilled' ? (r.value as any) : null;

  const cpiIndex = pick(nbs[0]);
  if (cpiIndex && typeof cpiIndex.value === 'number') {
    macro.push({
      id: 'CN_CPI_YOY',
      name: '中国CPI同比',
      region: 'CN',
      value: cpiIndex.value - 100,
      unit: '%',
      period: cpiIndex.period,
      prev_value:
        typeof cpiIndex.prev_value === 'number' ? cpiIndex.prev_value - 100 : undefined,
      prev_period: cpiIndex.prev_period,
      frequency: '月度',
    });
  }

  const ppiIndex = pick(nbs[1]);
  if (ppiIndex && typeof ppiIndex.value === 'number') {
    macro.push({
      id: 'CN_PPI_YOY',
      name: '中国PPI同比',
      region: 'CN',
      value: ppiIndex.value - 100,
      unit: '%',
      period: ppiIndex.period,
      prev_value:
        typeof ppiIndex.prev_value === 'number' ? ppiIndex.prev_value - 100 : undefined,
      prev_period: ppiIndex.prev_period,
      frequency: '月度',
    });
  }

  const pmiMfg = pick(nbs[2]);
  if (pmiMfg && typeof pmiMfg.value === 'number') {
    macro.push({
      id: 'CN_PMI_MFG',
      name: '中国PMI(制造业)',
      region: 'CN',
      value: pmiMfg.value,
      unit: '',
      period: pmiMfg.period,
      prev_value: pmiMfg.prev_value,
      prev_period: pmiMfg.prev_period,
      frequency: '月度',
    });
  }
  const pmiNon = pick(nbs[3]);
  if (pmiNon && typeof pmiNon.value === 'number') {
    macro.push({
      id: 'CN_PMI_NM',
      name: '中国PMI(非制造业)',
      region: 'CN',
      value: pmiNon.value,
      unit: '',
      period: pmiNon.period,
      prev_value: pmiNon.prev_value,
      prev_period: pmiNon.prev_period,
      frequency: '月度',
    });
  }
  const pmiComp = pick(nbs[4]);
  if (pmiComp && typeof pmiComp.value === 'number') {
    macro.push({
      id: 'CN_PMI_COMP',
      name: '中国PMI(综合产出)',
      region: 'CN',
      value: pmiComp.value,
      unit: '',
      period: pmiComp.period,
      prev_value: pmiComp.prev_value,
      prev_period: pmiComp.prev_period,
      frequency: '月度',
    });
  }

  const m2 = pick(nbs[5]);
  if (m2 && typeof m2.value === 'number') {
    macro.push({
      id: 'CN_M2_YOY',
      name: '中国M2同比',
      region: 'CN',
      value: m2.value,
      unit: '%',
      period: m2.period,
      prev_value: m2.prev_value,
      prev_period: m2.prev_period,
      frequency: '月度',
    });
  }

  const gdpIdx = pick(nbs[6]);
  if (gdpIdx && typeof gdpIdx.value === 'number') {
    macro.push({
      id: 'CN_GDP_YOY',
      name: '中国GDP同比',
      region: 'CN',
      value: gdpIdx.value - 100,
      unit: '%',
      period: gdpIdx.period,
      prev_value:
        typeof gdpIdx.prev_value === 'number' ? gdpIdx.prev_value - 100 : undefined,
      prev_period: gdpIdx.prev_period,
      frequency: '季度',
    });
  }

  // China rates (SHIBOR / LPR / 10Y)
  try {
    const shibor = await fetchShiborLatest();
    if (shibor?.records?.length) {
      const period = shibor.showDateCN?.split(' ')?.[0] || formatDateYYYYMMDDDashed(now);
      for (const r of shibor.records) {
        if (!['O/N', '1W', '2W', '1M', '3M', '6M', '9M', '1Y'].includes(r.term)) continue;
        const prevValue =
          typeof r.deltaBp === 'number' ? r.value - r.deltaBp / 100 : undefined;
        macro.push({
          id: `CN_SHIBOR_${r.term.replace('/', '')}`,
          name: `SHIBOR ${r.term}`,
          region: 'CN',
          value: r.value,
          unit: '%',
          period,
          prev_value: prevValue,
          prev_period: period,
          frequency: '日度',
        });
      }
    }
  } catch (err) {
    console.error('SHIBOR fetch failed', err);
  }

  try {
    const lpr = await fetchLprLatest();
    if (lpr?.records?.length) {
      const period = lpr.showDateCN || formatDateYYYYMMDDDashed(now);
      for (const r of lpr.records) {
        if (!['1Y', '5Y'].includes(r.term)) continue;
        macro.push({
          id: `CN_LPR_${r.term}`,
          name: `LPR ${r.term}`,
          region: 'CN',
          value: r.value,
          unit: '%',
          period,
          frequency: '月度',
        });
      }
    }
  } catch (err) {
    console.error('LPR fetch failed', err);
  }

  try {
    const cn10 = await fetchChinaBond10yLatest();
    if (cn10 && typeof cn10.value === 'number') {
      macro.push({
        id: 'CN_10Y_YIELD',
        name: '中国10年国债收益率',
        region: 'CN',
        value: cn10.value,
        unit: '%',
        period: cn10.period,
        prev_value: cn10.prev_value,
        prev_period: cn10.prev_period,
        frequency: '日度',
      });
    }
  } catch (err) {
    console.error('ChinaBond 10Y fetch failed', err);
  }

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

  // US money market rates (FRED)
  try {
    const rrp = await fetchFredLatest('RRPONTSYD');
    if (rrp && typeof rrp.value === 'number') {
      macro.push({
        id: 'US_RRP',
        name: '美联储隔夜逆回购(ON RRP)',
        region: 'US',
        value: rrp.value,
        unit: '%',
        period: rrp.period,
        prev_value: rrp.prev_value,
        prev_period: rrp.prev_period,
        frequency: '日度',
      });
    }
    const sofr = await fetchFredLatest('SOFR');
    if (sofr && typeof sofr.value === 'number') {
      macro.push({
        id: 'US_SOFR',
        name: 'SOFR',
        region: 'US',
        value: sofr.value,
        unit: '%',
        period: sofr.period,
        prev_value: sofr.prev_value,
        prev_period: sofr.prev_period,
        frequency: '日度',
      });
    }
    const liborProxy = await fetchFredLatest('IR3TIB01USM156N');
    if (liborProxy && typeof liborProxy.value === 'number') {
      macro.push({
        id: 'US_LIBOR_PROXY',
        name: '美元3个月拆借利率(替代LIBOR)',
        region: 'US',
        value: liborProxy.value,
        unit: '%',
        period: liborProxy.period,
        prev_value: liborProxy.prev_value,
        prev_period: liborProxy.prev_period,
        frequency: '月度',
      });
    }
  } catch (err) {
    console.error('FRED rates fetch failed', err);
  }

  // FX (no-key API) + prev from cache
  try {
    const rates = await fetchErApiUsdLatest();
    if (!rates) throw new Error('No FX rates');
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

  // World Bank (annual, lagged). Best-effort enrichment.
  try {
    const wb = await fetchWorldBankMacroItems();
    if (wb.length) macro.push(...wb);
  } catch (err) {
    console.error('WorldBank macro fetch failed', err);
  }

  // Daily ticker should only show latest snapshot; leave list-building to the client.
  const tickerMarket: MarketItem[] = market.map(({ history, ...rest }) => rest);

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

      // Always enrich with World Bank annual indicators (best-effort).
      try {
        const wb = await fetchWorldBankMacroItems();
        if (wb.length) {
          const existing = new Set(macro.map((m) => m.id));
          for (const item of wb) {
            if (!existing.has(item.id)) macro.push(item);
          }
        }
      } catch (err) {
        console.error('WorldBank macro fetch failed (tushare path)', err);
      }

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
