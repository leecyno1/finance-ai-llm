export type HoldingInput = {
  symbol: string;
  weight: number;
};

type HoldingProfile = {
  symbol: string;
  name: string;
  assetClass: 'Equity' | 'Bond' | 'Commodity' | 'REIT' | 'Cash' | 'FX' | 'Crypto';
  region: 'CN' | 'US' | 'HK' | 'EU' | 'JP' | 'Global';
  sector: string;
  factors: Record<string, number>; // -1 ~ +1
};

type PortfolioExposure = {
  byAssetClass: Record<string, number>;
  byRegion: Record<string, number>;
  bySector: Record<string, number>;
  factorExposure: Record<string, number>;
};

export type PortfolioCheckResult = {
  parsedHoldings: Array<HoldingInput & { normalizedWeight: number; profile: HoldingProfile }>;
  exposure: PortfolioExposure;
  topFactorSensitivities: Array<{ factor: string; value: number; interpretation: string }>;
  rebalanceSuggestions: string[];
  riskScore: number;
};

const KNOWN_PROFILES: Record<string, HoldingProfile> = {
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple',
    assetClass: 'Equity',
    region: 'US',
    sector: '科技',
    factors: { beta: 0.75, duration: -0.2, tech: 0.95, usd: 0.2, china: 0.2, inflation: -0.2 },
  },
  MSFT: {
    symbol: 'MSFT',
    name: 'Microsoft',
    assetClass: 'Equity',
    region: 'US',
    sector: '科技',
    factors: { beta: 0.7, duration: -0.2, tech: 0.95, usd: 0.2, china: 0.1, inflation: -0.2 },
  },
  NVDA: {
    symbol: 'NVDA',
    name: 'NVIDIA',
    assetClass: 'Equity',
    region: 'US',
    sector: '半导体',
    factors: { beta: 0.9, duration: -0.25, tech: 1, usd: 0.15, china: 0.25, inflation: -0.25 },
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla',
    assetClass: 'Equity',
    region: 'US',
    sector: '可选消费',
    factors: { beta: 1, duration: -0.3, tech: 0.7, usd: 0.1, china: 0.35, inflation: -0.3 },
  },
  SPY: {
    symbol: 'SPY',
    name: 'S&P 500 ETF',
    assetClass: 'Equity',
    region: 'US',
    sector: '宽基指数',
    factors: { beta: 0.85, duration: -0.2, tech: 0.45, usd: 0.2, china: 0.05, inflation: -0.2 },
  },
  QQQ: {
    symbol: 'QQQ',
    name: 'NASDAQ 100 ETF',
    assetClass: 'Equity',
    region: 'US',
    sector: '科技',
    factors: { beta: 0.95, duration: -0.25, tech: 0.8, usd: 0.2, china: 0.05, inflation: -0.25 },
  },
  CSI300: {
    symbol: 'CSI300',
    name: '沪深300',
    assetClass: 'Equity',
    region: 'CN',
    sector: 'A股宽基',
    factors: { beta: 0.8, duration: -0.15, tech: 0.2, usd: -0.15, china: 0.95, inflation: -0.1 },
  },
  HSI: {
    symbol: 'HSI',
    name: '恒生指数',
    assetClass: 'Equity',
    region: 'HK',
    sector: '港股宽基',
    factors: { beta: 0.85, duration: -0.2, tech: 0.45, usd: 0.1, china: 0.75, inflation: -0.15 },
  },
  TLT: {
    symbol: 'TLT',
    name: '20Y+ 美债ETF',
    assetClass: 'Bond',
    region: 'US',
    sector: '国债',
    factors: { beta: -0.25, duration: 1, tech: -0.1, usd: 0.1, china: 0, inflation: -0.65 },
  },
  IEF: {
    symbol: 'IEF',
    name: '7-10Y 美债ETF',
    assetClass: 'Bond',
    region: 'US',
    sector: '国债',
    factors: { beta: -0.2, duration: 0.7, tech: -0.05, usd: 0.1, china: 0, inflation: -0.45 },
  },
  GLD: {
    symbol: 'GLD',
    name: '黄金ETF',
    assetClass: 'Commodity',
    region: 'Global',
    sector: '贵金属',
    factors: { beta: 0.05, duration: 0.1, tech: 0, usd: -0.6, china: 0.1, inflation: 0.75 },
  },
  USO: {
    symbol: 'USO',
    name: '原油ETF',
    assetClass: 'Commodity',
    region: 'Global',
    sector: '能源',
    factors: { beta: 0.3, duration: -0.05, tech: 0, usd: -0.35, china: 0.15, inflation: 0.8 },
  },
  VNQ: {
    symbol: 'VNQ',
    name: '美国REITs ETF',
    assetClass: 'REIT',
    region: 'US',
    sector: '地产',
    factors: { beta: 0.6, duration: 0.25, tech: 0, usd: 0.1, china: 0, inflation: 0.3 },
  },
  CASH: {
    symbol: 'CASH',
    name: '现金',
    assetClass: 'Cash',
    region: 'Global',
    sector: '现金',
    factors: { beta: -0.2, duration: 0.05, tech: 0, usd: 0.1, china: 0, inflation: -0.1 },
  },
};

const DEFAULT_PROFILE = (symbol: string): HoldingProfile => ({
  symbol,
  name: symbol,
  assetClass: 'Equity',
  region: 'Global',
  sector: '未知行业',
  factors: { beta: 0.7, duration: -0.1, tech: 0.2, usd: 0.1, china: 0.1, inflation: -0.1 },
});

const normalizeSymbol = (v: string) =>
  (v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_.-]/g, '');

const parseWeight = (raw: string) => {
  const s = raw.replace(/[%，,\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const tryParseJson = (input: string): HoldingInput[] | null => {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return null;

    const rows = parsed
      .map((it) => ({
        symbol: normalizeSymbol(String(it?.symbol ?? it?.code ?? '')),
        weight: Number(it?.weight ?? it?.w ?? NaN),
      }))
      .filter((x) => x.symbol && Number.isFinite(x.weight) && x.weight > 0);

    return rows.length ? rows : null;
  } catch {
    return null;
  }
};

export const parsePortfolioInput = (input: string): HoldingInput[] => {
  const jsonRows = tryParseJson(input);
  if (jsonRows) return jsonRows;

  const lines = input
    .split(/\n|;|；/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: HoldingInput[] = [];

  for (const line of lines) {
    const parts = line
      .split(/\s+|,|，|\|/g)
      .map((x) => x.trim())
      .filter(Boolean);

    if (parts.length < 2) continue;

    const symbol = normalizeSymbol(parts[0] || '');
    const weight = parseWeight(parts[1] || '');
    if (!symbol || !Number.isFinite(weight) || weight <= 0) continue;

    out.push({ symbol, weight });
  }

  return out;
};

const toPercentMap = (map: Record<string, number>) => {
  const out: Record<string, number> = {};
  Object.entries(map).forEach(([k, v]) => {
    out[k] = Number(v.toFixed(2));
  });
  return out;
};

const sumBy = (
  rows: Array<{ normalizedWeight: number; profile: HoldingProfile }>,
  pick: (profile: HoldingProfile) => string,
) => {
  const m: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row.profile);
    m[key] = (m[key] || 0) + row.normalizedWeight;
  }
  return toPercentMap(m);
};

const computeFactorExposure = (
  rows: Array<{ normalizedWeight: number; profile: HoldingProfile }>,
) => {
  const factors: Record<string, number> = {};
  for (const row of rows) {
    const { normalizedWeight, profile } = row;
    Object.entries(profile.factors).forEach(([factor, factorValue]) => {
      factors[factor] = (factors[factor] || 0) + (normalizedWeight / 100) * factorValue;
    });
  }

  Object.keys(factors).forEach((k) => {
    factors[k] = Number(factors[k]!.toFixed(3));
  });
  return factors;
};

const interpretFactor = (factor: string, value: number) => {
  const strength = Math.abs(value) >= 0.55 ? '高' : Math.abs(value) >= 0.3 ? '中' : '低';
  const direction = value >= 0 ? '正暴露' : '负暴露';
  return `${strength}${direction}`;
};

const buildRebalanceSuggestions = (result: PortfolioCheckResult) => {
  const suggestions: string[] = [];
  const assetClass = result.exposure.byAssetClass;
  const region = result.exposure.byRegion;
  const sectors = result.exposure.bySector;

  const equity = assetClass.Equity || 0;
  const bond = assetClass.Bond || 0;
  const commodity = assetClass.Commodity || 0;
  const cash = assetClass.Cash || 0;

  const maxRegion = Object.entries(region).sort((a, b) => b[1] - a[1])[0];
  const maxSector = Object.entries(sectors).sort((a, b) => b[1] - a[1])[0];

  if (equity > 75 && bond < 15) {
    suggestions.push('股票仓位偏高且债券不足，建议降低权益 5%-10%，增配中短久期利率债。');
  }
  if (commodity < 3) {
    suggestions.push('商品对冲偏弱，可考虑配置 3%-8% 黄金/商品以提升抗通胀能力。');
  }
  if (cash < 3) {
    suggestions.push('现金缓冲较低，建议预留 3%-8% 流动性仓位用于回撤与战术加仓。');
  }
  if (maxRegion && maxRegion[1] > 60) {
    suggestions.push(`区域集中在 ${maxRegion[0]}（${maxRegion[1].toFixed(1)}%），建议做跨区域分散。`);
  }
  if (maxSector && maxSector[1] > 35) {
    suggestions.push(`行业集中在 ${maxSector[0]}（${maxSector[1].toFixed(1)}%），建议降至 25%-30% 以下。`);
  }

  const beta = result.exposure.factorExposure.beta || 0;
  const duration = result.exposure.factorExposure.duration || 0;
  const inflation = result.exposure.factorExposure.inflation || 0;

  if (beta > 0.75) {
    suggestions.push('组合 Beta 偏高，建议增加低波动资产或保护性对冲。');
  }
  if (duration < -0.25) {
    suggestions.push('利率敏感度偏负，若进入降息周期可能跑输，可增配久期资产。');
  }
  if (inflation < -0.2) {
    suggestions.push('通胀因子暴露为负，建议增加商品/资源类资产对冲。');
  }

  if (!suggestions.length) {
    suggestions.push('当前组合结构相对均衡，可继续按月做小幅再平衡并监控风险因子漂移。');
  }

  return suggestions.slice(0, 6);
};

export const runPortfolioCheck = (input: string): PortfolioCheckResult | null => {
  const holdings = parsePortfolioInput(input);
  if (!holdings.length) return null;

  const totalWeight = holdings.reduce((acc, cur) => acc + cur.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  const rows = holdings.map((h) => {
    const profile = KNOWN_PROFILES[h.symbol] || DEFAULT_PROFILE(h.symbol);
    const normalizedWeight = (h.weight / totalWeight) * 100;
    return {
      ...h,
      normalizedWeight: Number(normalizedWeight.toFixed(2)),
      profile,
    };
  });

  const factorExposure = computeFactorExposure(rows);

  const topFactorSensitivities = Object.entries(factorExposure)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
    .map(([factor, value]) => ({
      factor,
      value,
      interpretation: interpretFactor(factor, value),
    }));

  const riskScoreRaw =
    50 +
    (factorExposure.beta || 0) * 25 +
    Math.abs(factorExposure.duration || 0) * 10 +
    Math.abs(factorExposure.inflation || 0) * 8;

  const riskScore = Math.max(0, Math.min(100, Number(riskScoreRaw.toFixed(1))));

  const result: PortfolioCheckResult = {
    parsedHoldings: rows,
    exposure: {
      byAssetClass: sumBy(rows, (p) => p.assetClass),
      byRegion: sumBy(rows, (p) => p.region),
      bySector: sumBy(rows, (p) => p.sector),
      factorExposure,
    },
    topFactorSensitivities,
    rebalanceSuggestions: [],
    riskScore,
  };

  result.rebalanceSuggestions = buildRebalanceSuggestions(result);
  return result;
};

const toRows = (map: Record<string, number>) =>
  Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v.toFixed(2)}% |`)
    .join('\n');

export const formatPortfolioCheckAsMarkdown = (result: PortfolioCheckResult | null) => {
  if (!result) {
    return [
      '## 组合体检模式',
      '',
      '未识别到有效持仓输入。请使用以下任一格式：',
      '',
      '- `AAPL 30%`（每行一个）',
      '- `SPY,40`',
      '- `[ {"symbol":"AAPL","weight":30}, {"symbol":"TLT","weight":20} ]`',
    ].join('\n');
  }

  const holdingsRows = result.parsedHoldings
    .sort((a, b) => b.normalizedWeight - a.normalizedWeight)
    .map(
      (h) =>
        `| ${h.symbol} | ${h.profile.name} | ${h.profile.assetClass} | ${h.profile.region} | ${h.profile.sector} | ${h.normalizedWeight.toFixed(2)}% |`,
    )
    .join('\n');

  const factorRows = result.topFactorSensitivities
    .map(
      (f) =>
        `| ${f.factor} | ${f.value.toFixed(3)} | ${f.interpretation} |`,
    )
    .join('\n');

  const suggestions = result.rebalanceSuggestions
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');

  return [
    '## 组合体检报告',
    '',
    `风险评分：**${result.riskScore.toFixed(1)} / 100**`,
    '',
    '### 持仓识别',
    '| 代码 | 标的 | 资产类型 | 区域 | 行业 | 权重 |',
    '| --- | --- | --- | --- | --- | --- |',
    holdingsRows,
    '',
    '### 暴露结构',
    '**资产类型暴露**',
    '| 类别 | 占比 |',
    '| --- | --- |',
    toRows(result.exposure.byAssetClass),
    '',
    '**区域暴露**',
    '| 区域 | 占比 |',
    '| --- | --- |',
    toRows(result.exposure.byRegion),
    '',
    '**行业暴露（前几项）**',
    '| 行业 | 占比 |',
    '| --- | --- |',
    toRows(result.exposure.bySector),
    '',
    '### 敏感因子',
    '| 因子 | 暴露值 | 解读 |',
    '| --- | --- | --- |',
    factorRows,
    '',
    '### 再平衡建议',
    suggestions,
    '',
    '注：本体检为规则引擎结果，不构成投资建议。',
  ].join('\n');
};
