import fs from 'fs';
import path from 'path';
import { getFundUniverseLocalPath } from '@/lib/config/serverRegistry';
import type { TargetImpactSummary } from './eventImpact';

export type FundUniverseItem = {
  tsCode: string;
  name: string;
  secName: string;
  category: string;
  manager: string;
  ret6m: number | null;
  ret1y: number | null;
  scaleYi: number | null;
  style: string;
  firstType: string;
  riskLevel: string;
  intro: string;
  majorIndustries: string;
  industryDate: string;
  setupDate: string;
  company: string;
};

export type FundRecommendationItem = {
  tsCode: string;
  name: string;
  category: string;
  style: string;
  riskLevel: string;
  manager: string;
  ret6m: number | null;
  ret1y: number | null;
  scaleYi: number | null;
  matchScore: number;
  reason: string;
  riskPrompt: string;
};

export type TargetFundRecommendation = {
  target: string;
  direction: 'positive' | 'mixed' | 'negative';
  confidence: number;
  eventCount: number;
  funds: FundRecommendationItem[];
  riskHint: string;
};

export type AllocationMarketView = {
  outlook: '偏进攻' | '均衡' | '偏防守';
  confidence: number;
  marketView: string;
  reasoning: string;
  llmGenerated: boolean;
  providerId?: string;
  model?: string;
  error?: string;
};

export type AllocationBucket = {
  assetClass: string;
  weight: number;
  fund: FundRecommendationItem | null;
  note: string;
};

export type AssetAllocationPlan = {
  name: string;
  profile: '进攻' | '均衡' | '防守';
  expectedScenario: string;
  buckets: AllocationBucket[];
};

export type AssetAllocationView = AllocationMarketView & {
  plans: AssetAllocationPlan[];
};

type FundUniverseFile = {
  source?: string;
  count?: number;
  items?: FundUniverseItem[];
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const STATIC_FUND_JSON_PATH = path.join(
  process.cwd(),
  'src/lib/finance/data/southern-fund-a-universe.json',
);
const RUNTIME_FUND_JSON_PATH = path.join(
  DATA_DIR,
  'data/fund/southern-fund-a-universe.json',
);
const RUNTIME_DEFAULT_FUND_JSON_PATH = path.join(
  DATA_DIR,
  'data/fund/local-fund-universe.json',
);

let cachedFunds:
  | {
      sourcePath: string;
      mtimeMs: number;
      items: FundUniverseItem[];
    }
  | null = null;

const normalize = (v: string) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ');

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const uniqueStrings = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const parseRiskRank = (riskLevel: string) => {
  const m = String(riskLevel || '').match(/R\s*(\d)/i);
  const n = Number(m?.[1]);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return n;
  return 3;
};

const resolveConfiguredLocalPath = (configuredPath: string) => {
  if (!configuredPath) return '';
  if (path.isAbsolute(configuredPath)) return configuredPath;
  return path.join(DATA_DIR, configuredPath);
};

const buildCandidateSourcePaths = (configuredPath: string) => {
  const configuredResolved = resolveConfiguredLocalPath(configuredPath);
  const raw = [
    configuredResolved,
    RUNTIME_DEFAULT_FUND_JSON_PATH,
    STATIC_FUND_JSON_PATH,
    RUNTIME_FUND_JSON_PATH,
  ].filter(Boolean);

  const seen = new Set<string>();
  return raw.filter((p) => {
    const normalized = path.normalize(p);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const loadFundUniverse = (
  configuredPath: string,
): {
  items: FundUniverseItem[];
  sourcePath: string;
} => {
  try {
    const candidates = buildCandidateSourcePaths(configuredPath);
    const sourcePath = candidates.find((p) => fs.existsSync(p)) || '';
    if (!sourcePath) {
      return { items: [], sourcePath: '' };
    }

    const stat = fs.statSync(sourcePath);
    if (
      cachedFunds &&
      cachedFunds.sourcePath === sourcePath &&
      cachedFunds.mtimeMs === stat.mtimeMs
    ) {
      return {
        items: cachedFunds.items,
        sourcePath,
      };
    }

    const raw = fs.readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(raw) as FundUniverseFile;
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    cachedFunds = {
      sourcePath,
      mtimeMs: stat.mtimeMs,
      items,
    };
    return { items, sourcePath };
  } catch {
    return { items: [], sourcePath: '' };
  }
};

export const getLocalFundUniverseWithMeta = () => {
  const configuredPath = getFundUniverseLocalPath();
  const loaded = loadFundUniverse(configuredPath);
  return {
    items: loaded.items,
    sourcePath: loaded.sourcePath,
    configuredPath,
    configured: Boolean(configuredPath),
  };
};

export const getLocalFundUniverse = () => getLocalFundUniverseWithMeta().items;

export const filterFundUniverseByCompany = (
  funds: FundUniverseItem[],
  companyKeywords: string[],
) => {
  const keywords = companyKeywords.map(normalize).filter(Boolean);
  if (!keywords.length) return funds;

  return funds.filter((fund) => {
    const hay = normalize(`${fund.company} ${fund.manager} ${fund.name} ${fund.intro}`);
    return keywords.some((k) => hay.includes(k));
  });
};

export const mergeFundUniverse = (
  base: FundUniverseItem[],
  extra: FundUniverseItem[],
) => {
  const map = new Map<string, FundUniverseItem>();

  const normalized = [...base, ...extra]
    .filter((x) => x && x.tsCode && x.name)
    .map((x) => ({
      ...x,
      tsCode: String(x.tsCode).trim().toUpperCase(),
      name: String(x.name).trim(),
      secName: String(x.secName || x.name || '').trim(),
      category: String(x.category || '').trim(),
      manager: String(x.manager || '').trim(),
      style: String(x.style || '').trim(),
      firstType: String(x.firstType || '').trim(),
      riskLevel: String(x.riskLevel || '').trim(),
      intro: String(x.intro || '').trim(),
      majorIndustries: String(x.majorIndustries || '').trim(),
      industryDate: String(x.industryDate || '').trim(),
      setupDate: String(x.setupDate || '').trim(),
      company: String(x.company || '').trim(),
    }));

  for (const item of normalized) {
    if (!map.has(item.tsCode)) {
      map.set(item.tsCode, item);
      continue;
    }

    // Prefer richer fields when duplicate ts_code appears.
    const prev = map.get(item.tsCode)!;
    const merged: FundUniverseItem = {
      ...prev,
      ...item,
      ret6m: item.ret6m ?? prev.ret6m,
      ret1y: item.ret1y ?? prev.ret1y,
      scaleYi: item.scaleYi ?? prev.scaleYi,
      intro: item.intro || prev.intro,
      majorIndustries: item.majorIndustries || prev.majorIndustries,
      riskLevel: item.riskLevel || prev.riskLevel,
      firstType: item.firstType || prev.firstType,
      style: item.style || prev.style,
      company: item.company || prev.company,
      manager: item.manager || prev.manager,
    };
    map.set(item.tsCode, merged);
  }

  return Array.from(map.values());
};

const TARGET_ALIAS_TERMS: Array<{ when: string[]; terms: string[] }> = [
  { when: ['半导体', '芯片', '算力', 'ai', '人工智能'], terms: ['半导体', '芯片', '科技', '数字经济', '通信'] },
  { when: ['成长科技', '成长', '高估值', '科技'], terms: ['数字经济', '科技', '通信', '中证1000', '科创板'] },
  { when: ['银行'], terms: ['银行', '红利', '沪深300'] },
  { when: ['能源', '原油', '油气', '周期'], terms: ['周期', '资源', '小金属', '黄金'] },
  { when: ['黄金', '贵金属'], terms: ['黄金'] },
  { when: ['地产', '地产链', '建材'], terms: ['建材', '周期', '沪深300'] },
  { when: ['消费', '可选消费', '必选消费'], terms: ['消费', '沪深300'] },
  { when: ['纳斯达克', '美股', '海外'], terms: ['纳斯达克', 'qdii', '港股'] },
  { when: ['长端', '美债', '国债', '债券', '利率'], terms: ['债券', '中债', '国债'] },
  { when: ['军工'], terms: ['国防', '军工'] },
  { when: ['公用事业'], terms: ['公用事业', '红利', '债券'] },
];

const buildTargetTerms = (target: string) => {
  const terms = new Set<string>();
  const normalizedTarget = normalize(target);
  if (normalizedTarget) terms.add(normalizedTarget);

  TARGET_ALIAS_TERMS.forEach((rule) => {
    if (rule.when.some((k) => normalizedTarget.includes(normalize(k)))) {
      rule.terms.forEach((t) => terms.add(normalize(t)));
    }
  });

  normalizedTarget
    .split(/[、,，\-\/\s]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .forEach((x) => terms.add(x));

  return Array.from(terms).slice(0, 10);
};

const fundText = (fund: FundUniverseItem) =>
  normalize(
    [
      fund.name,
      fund.secName,
      fund.category,
      fund.style,
      fund.firstType,
      fund.riskLevel,
      fund.intro,
      fund.majorIndustries,
      fund.company,
    ].join(' '),
  );

const deriveRiskPrompt = (
  fund: FundUniverseItem,
  direction: 'positive' | 'mixed' | 'negative',
  confidence: number,
) => {
  const riskRank = parseRiskRank(fund.riskLevel);
  const common = `基金风险等级 ${fund.riskLevel || 'R3-中风险'}，需结合你的回撤承受能力。`;

  if (direction === 'negative') {
    if (riskRank >= 4) {
      return `当前信号偏利空，该基金波动可能放大。${common}`;
    }
    return `当前信号偏利空，建议分批配置并设置止损/再平衡阈值。${common}`;
  }

  if (direction === 'mixed') {
    return `当前信号分化，建议仓位中性并与低波资产搭配。${common}`;
  }

  if (confidence >= 0.75 && riskRank >= 4) {
    return `信号偏利多但波动较大，建议控制单只仓位上限。${common}`;
  }

  return `信号偏利多，注意行业拥挤交易风险与阶段性回撤。${common}`;
};

const buildFundReason = (target: string, terms: string[], fund: FundUniverseItem) => {
  const txt = fundText(fund);
  const matchedTerms = terms.filter((term) => term && txt.includes(term)).slice(0, 3);
  const reasonParts: string[] = [];

  if (matchedTerms.length) {
    reasonParts.push(`与“${target}”匹配关键词：${matchedTerms.join('、')}`);
  }

  if (Number.isFinite(fund.ret1y)) {
    reasonParts.push(`近一年收益 ${Number(fund.ret1y).toFixed(2)}%`);
  }

  if (fund.riskLevel) {
    reasonParts.push(`风险等级 ${fund.riskLevel}`);
  }

  return reasonParts.join('；') || `基金主题与“${target}”相关。`;
};

const styleText = (fund: FundUniverseItem) =>
  normalize(
    [
      fund.name,
      fund.style,
      fund.firstType,
      fund.category,
      fund.intro,
      fund.majorIndustries,
    ].join(' '),
  );

type FundTraits = {
  isBond: boolean;
  isMoney: boolean;
  isGold: boolean;
  isOverseas: boolean;
  isLowVol: boolean;
  isEquityLike: boolean;
  isGrowthLike: boolean;
};

const buildFundTraits = (fund: FundUniverseItem): FundTraits => {
  const coreText = normalize(
    [
      fund.name,
      fund.secName,
      fund.category,
      fund.style,
      fund.firstType,
    ].join(' '),
  );
  const extendedText = normalize(
    [
      coreText,
      fund.intro,
      fund.majorIndustries,
    ].join(' '),
  );

  const isBondCore = /债|固收|中债|国债|信用债|利率债|纯债|短债|中短债|债券/.test(coreText);
  const isMoneyCore = /货币|现金管理|同业存单|短融|现金替代/.test(coreText);
  const isBond = isBondCore || isMoneyCore;
  const isMoney = isMoneyCore;
  const isGold = /黄金|贵金属|上海金|金etf|商品/.test(coreText);
  const isOverseas = /qdii|海外|美股|港股|纳斯达克|标普|恒生|日经/.test(coreText);
  const isLowVol = /红利|低波|价值|股息|稳健|低估值/.test(extendedText);
  const isEquityLike = /股票|权益|指数|etf|科创|创业板|中证|沪深300|成长|科技|混合/.test(coreText);
  const isGrowthLike = /成长|科技|芯片|半导体|算力|ai|数字经济|创新/.test(extendedText);

  return {
    isBond,
    isMoney,
    isGold,
    isOverseas,
    isLowVol,
    isEquityLike,
    isGrowthLike,
  };
};

type AllocationBucketIntent =
  | 'bond_core'
  | 'gold_hedge'
  | 'overseas'
  | 'lowvol_equity'
  | 'equity_core'
  | 'theme_enhance'
  | 'cash_like'
  | 'generic';

const inferAllocationBucketIntent = (
  assetClass: string,
  terms: string[],
): AllocationBucketIntent => {
  const assetText = normalize(assetClass);
  const fullText = normalize(`${assetClass} ${terms.join(' ')}`);
  if (/战术/.test(assetText)) return 'cash_like';
  if (/低波|红利/.test(assetText)) return 'lowvol_equity';
  if (/海外|qdii|纳斯达克|港股|美股/.test(assetText)) return 'overseas';
  if (/黄金|贵金属|避险|商品/.test(assetText)) return 'gold_hedge';
  if (/固收|债|现金|短债|货币|现金替代|底仓/.test(assetText)) return 'bond_core';
  if (/主题|增强|赛道/.test(assetText)) return 'theme_enhance';
  if (/权益核心|权益|核心/.test(assetText)) return 'equity_core';

  if (/低波|红利|防守/.test(fullText)) return 'lowvol_equity';
  if (/海外|qdii|纳斯达克|港股|美股/.test(fullText)) return 'overseas';
  if (/黄金|贵金属|避险|商品/.test(fullText)) return 'gold_hedge';
  if (/固收|债|现金|短债|货币|现金替代|底仓/.test(fullText)) return 'bond_core';
  if (/主题|增强|赛道/.test(fullText)) return 'theme_enhance';
  if (/权益核心|权益|核心/.test(fullText)) return 'equity_core';
  return 'generic';
};

const scoreBucketIntentFit = (
  fund: FundUniverseItem,
  intent: AllocationBucketIntent,
): { fit: number; mismatch: boolean } => {
  const traits = buildFundTraits(fund);
  const riskRank = parseRiskRank(fund.riskLevel);

  if (intent === 'bond_core') {
    if (traits.isBond || traits.isMoney) return { fit: 1.15, mismatch: false };
    if (traits.isGold) return { fit: -0.6, mismatch: true };
    return { fit: -1.05, mismatch: true };
  }

  if (intent === 'gold_hedge') {
    if (traits.isGold) return { fit: 1.2, mismatch: false };
    return { fit: -1.1, mismatch: true };
  }

  if (intent === 'overseas') {
    if (traits.isOverseas) return { fit: 1.1, mismatch: false };
    return { fit: -0.9, mismatch: true };
  }

  if (intent === 'lowvol_equity') {
    if (traits.isLowVol && !traits.isGold && !traits.isOverseas) return { fit: 1.05, mismatch: false };
    if (traits.isBond && riskRank <= 3) return { fit: 0.25, mismatch: false };
    return { fit: -0.7, mismatch: true };
  }

  if (intent === 'equity_core') {
    if (traits.isEquityLike && !traits.isBond && !traits.isMoney) return { fit: 0.95, mismatch: false };
    if (traits.isLowVol && traits.isEquityLike) return { fit: 0.55, mismatch: false };
    return { fit: -0.75, mismatch: true };
  }

  if (intent === 'theme_enhance') {
    if (traits.isGrowthLike || traits.isEquityLike) return { fit: 1.08, mismatch: false };
    return { fit: -0.9, mismatch: true };
  }

  if (intent === 'cash_like') {
    if (traits.isMoney || traits.isBond) return { fit: 1.0, mismatch: false };
    return { fit: -0.75, mismatch: true };
  }

  return { fit: 0.4, mismatch: false };
};

const requiresStrictBucketMatch = (intent: AllocationBucketIntent) =>
  intent === 'bond_core' ||
  intent === 'gold_hedge' ||
  intent === 'overseas' ||
  intent === 'lowvol_equity' ||
  intent === 'equity_core' ||
  intent === 'theme_enhance' ||
  intent === 'cash_like';

const computeFundQuality = (fund: FundUniverseItem) => {
  const riskRank = parseRiskRank(fund.riskLevel);
  const ret1y = Number.isFinite(fund.ret1y) ? Number(fund.ret1y) : 0;
  const ret6m = Number.isFinite(fund.ret6m) ? Number(fund.ret6m) : 0;
  const scaleYi = Number.isFinite(fund.scaleYi) ? Number(fund.scaleYi) : 0;

  const perfScore =
    clamp((ret1y + 20) / 120, 0, 1) * 0.6 +
    clamp((ret6m + 10) / 60, 0, 1) * 0.4;
  const sizeScore = clamp(Math.log10(1 + Math.max(0, scaleYi)) / 2.1, 0, 1);
  return {
    riskRank,
    perfScore,
    sizeScore,
  };
};

const styleIntentBonus = (
  text: string,
  target: string,
  direction: 'positive' | 'mixed' | 'negative',
) => {
  let bonus = 0;
  const targetNorm = normalize(target);

  if (/红利|低波|价值|防御|高股息/.test(targetNorm) && /红利|低波|价值|股息/.test(text)) {
    bonus += 0.9;
  }
  if (/成长|科技|算力|芯片|数字经济|人工智能/.test(targetNorm) && /成长|科技|芯片|半导体|数字经济|ai/.test(text)) {
    bonus += 1.0;
  }
  if (/债|利率|国债|中债|美债/.test(targetNorm) && /债|固收|国债|信用债|中短债/.test(text)) {
    bonus += 1.0;
  }
  if (/黄金|贵金属|避险|地缘|通胀/.test(targetNorm) && /黄金|贵金属|商品/.test(text)) {
    bonus += 1.0;
  }
  if (/纳斯达克|美股|海外|qdii|港股/.test(targetNorm) && /纳斯达克|美股|海外|qdii|港股/.test(text)) {
    bonus += 0.95;
  }

  if (direction === 'negative' && /债|货币|黄金|红利|低波/.test(text)) {
    bonus += 0.45;
  }
  if (direction === 'positive' && /成长|科技|弹性|高景气/.test(text)) {
    bonus += 0.3;
  }
  return bonus;
};

const conceptMatchStats = (fund: FundUniverseItem, target: string) => {
  const terms = buildTargetTerms(target);
  const text = fundText(fund);
  const targetNorm = normalize(target);
  const termHitCount = terms.reduce((acc, term) => {
    if (!term) return acc;
    return text.includes(term) ? acc + 1 : acc;
  }, 0);
  const literalHit = Boolean(targetNorm && text.includes(targetNorm));
  const defensiveHit = /债|货币|黄金|低波|红利|固收/.test(text);
  const growthHit = /成长|科技|芯片|半导体|算力|ai|数字经济/.test(text);
  return {
    termHitCount,
    literalHit,
    defensiveHit,
    growthHit,
  };
};

const scoreFundForTarget = (
  fund: FundUniverseItem,
  target: string,
  direction: 'positive' | 'mixed' | 'negative',
  confidence: number,
) => {
  const terms = buildTargetTerms(target);
  const text = fundText(fund);
  const style = styleText(fund);
  const targetNorm = normalize(target);
  const match = conceptMatchStats(fund, target);

  let conceptScore = 0;
  if (targetNorm && text.includes(targetNorm)) conceptScore += 1.25;

  let matchedTermCount = 0;
  terms.forEach((term) => {
    if (!term) return;
    if (text.includes(term)) {
      conceptScore += 0.48;
      matchedTermCount += 1;
    }
  });
  conceptScore = clamp(conceptScore + Math.min(0.65, matchedTermCount * 0.07), 0, 3.2);

  const { riskRank, perfScore, sizeScore } = computeFundQuality(fund);
  const intentBonus = styleIntentBonus(style, target, direction);
  const liquidityBonus = sizeScore * 0.45;
  const qualityScore = perfScore * 0.75 + liquidityBonus;

  let score = conceptScore * 0.52 + qualityScore * 0.34 + intentBonus * 0.14;

  if (direction === 'positive') {
    score += perfScore * 0.95 + confidence * 0.5;
    if (riskRank >= 4 && confidence >= 0.7) score += 0.35;
    if (riskRank <= 2) score -= 0.25;
  } else if (direction === 'negative') {
    score += (6 - riskRank) * 0.48 + sizeScore * 0.35;
    if (/债券|黄金|货币|红利|低波/.test(`${fund.firstType}${fund.name}${fund.style}`)) score += 0.95;
    if (riskRank >= 4) score -= 0.35;
  } else {
    score += perfScore * 0.55 + sizeScore * 0.42;
    if (riskRank === 3 || riskRank === 4) score += 0.22;
  }

  if (/债券/.test(fund.firstType)) {
    if (/债|利率|美债|国债/.test(target)) score += 1.4;
    if (direction === 'negative') score += 0.55;
  }

  if (/黄金/.test(`${fund.name}${fund.intro}${fund.majorIndustries}`)) {
    if (/黄金|贵金属|通胀|地缘/.test(target)) score += 1.5;
    if (direction === 'negative') score += 0.25;
  }

  if (/纳斯达克|qdii|港股/.test(`${fund.name}${fund.intro}`.toLowerCase()) && /纳斯达克|美股|海外|港股/.test(targetNorm)) {
    score += 1.3;
  }

  // Hard penalty for concept mismatch to avoid selecting high-return but irrelevant funds.
  if (!match.literalHit && match.termHitCount === 0) {
    if (direction === 'positive') {
      score -= 1.6;
    } else if (direction === 'negative') {
      score -= match.defensiveHit ? 0.4 : 1.2;
    } else {
      score -= 1.0;
    }
  }

  if (direction === 'positive' && !match.growthHit && /成长|科技|芯片|ai|算力|数字经济/.test(targetNorm)) {
    score -= 0.65;
  }

  return score;
};

const toFundRecommendation = (
  fund: FundUniverseItem,
  score: number,
  target: string,
  direction: 'positive' | 'mixed' | 'negative',
  confidence: number,
): FundRecommendationItem => ({
  tsCode: fund.tsCode,
  name: fund.name,
  category: fund.category,
  style: fund.style,
  riskLevel: fund.riskLevel,
  manager: fund.manager,
  ret6m: fund.ret6m,
  ret1y: fund.ret1y,
  scaleYi: fund.scaleYi,
  matchScore: Number(score.toFixed(2)),
  reason: buildFundReason(target, buildTargetTerms(target), fund),
  riskPrompt: deriveRiskPrompt(fund, direction, confidence),
});

const buildTargetRiskHint = (
  direction: 'positive' | 'mixed' | 'negative',
  confidence: number,
  funds: FundRecommendationItem[],
) => {
  const highRiskCount = funds.filter((f) => parseRiskRank(f.riskLevel) >= 4).length;

  if (direction === 'negative') {
    return `当前市场信号偏利空，建议降低高波动仓位；高风险基金占比 ${highRiskCount}/${funds.length}。`;
  }
  if (direction === 'mixed') {
    return `当前市场信号分化，建议采用“核心+卫星”配置，核心仓优先中风险基金。`;
  }
  if (confidence >= 0.75) {
    return `当前市场信号偏利多（置信度 ${(confidence * 100).toFixed(0)}%），但需防止主题拥挤与估值回撤。`;
  }
  return `当前市场偏利多但确定性一般，建议分批建仓并跟踪回撤阈值。`;
};

export const buildTargetFundRecommendations = (
  summaryRows: TargetImpactSummary[],
  opts?: {
    topTargets?: number;
    topFundsPerTarget?: number;
    fundUniverse?: FundUniverseItem[];
  },
): TargetFundRecommendation[] => {
  const funds = opts?.fundUniverse?.length
    ? opts.fundUniverse
    : getLocalFundUniverse();
  if (!funds.length || !summaryRows.length) return [];

  const topTargets = Math.max(1, Math.min(60, opts?.topTargets ?? 20));
  const topFundsPerTarget = Math.max(1, Math.min(6, opts?.topFundsPerTarget ?? 3));

  const usedTsCodes = new Set<string>();
  return summaryRows.slice(0, topTargets).map((targetRow) => {
    const scored = funds
      .map((fund) => ({
        fund,
        score: scoreFundForTarget(
          fund,
          targetRow.target,
          targetRow.direction,
          targetRow.confidence,
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(18, topFundsPerTarget * 8));

    const directionalQualified = scored.filter((x) => {
      const riskRank = parseRiskRank(x.fund.riskLevel);
      const style = styleText(x.fund);
      const match = conceptMatchStats(x.fund, targetRow.target);
      const hasConceptMatch = match.literalHit || match.termHitCount > 0;

      if (targetRow.direction === 'positive') {
        return x.score > 1.35 && riskRank >= 2 && hasConceptMatch;
      }
      if (targetRow.direction === 'negative') {
        return (
          x.score > 1.2 &&
          (hasConceptMatch || /债|黄金|货币|低波|红利/.test(style)) &&
          (riskRank <= 3 || /债|黄金|货币|低波|红利/.test(style))
        );
      }
      return x.score > 1.3 && hasConceptMatch;
    });

    const primaryPool = directionalQualified.length ? directionalQualified : scored;
    const shortlisted = primaryPool
      .filter((x) => !usedTsCodes.has(x.fund.tsCode))
      .slice(0, topFundsPerTarget);

    const fallback =
      shortlisted.length >= topFundsPerTarget
        ? shortlisted
        : funds
            .map((fund) => ({
              fund,
              score:
                (Number.isFinite(fund.ret1y) ? Number(fund.ret1y) : 0) * 0.04 +
                (6 - parseRiskRank(fund.riskLevel)) * (targetRow.direction === 'negative' ? 0.3 : 0.1),
            }))
            .filter((x) => !usedTsCodes.has(x.fund.tsCode))
            .sort((a, b) => b.score - a.score)
            .slice(0, topFundsPerTarget);

    const selected = (shortlisted.length ? shortlisted : fallback).map((x) =>
      toFundRecommendation(
        x.fund,
        x.score,
        targetRow.target,
        targetRow.direction,
        targetRow.confidence,
      ),
    );
    selected.forEach((x) => usedTsCodes.add(x.tsCode));

    return {
      target: targetRow.target,
      direction: targetRow.direction,
      confidence: targetRow.confidence,
      eventCount: targetRow.eventCount,
      funds: selected,
      riskHint: buildTargetRiskHint(targetRow.direction, targetRow.confidence, selected),
    };
  });
};

const fallbackOutlookFromSummary = (
  summaryRows: TargetImpactSummary[],
): '偏进攻' | '均衡' | '偏防守' => {
  if (!summaryRows.length) return '均衡';

  let pos = 0;
  let neg = 0;
  let mixed = 0;
  summaryRows.forEach((r) => {
    if (r.direction === 'positive') pos += r.totalWeight;
    else if (r.direction === 'negative') neg += r.totalWeight;
    else mixed += r.totalWeight;
  });

  const total = pos + neg + mixed;
  if (total <= 0) return '均衡';

  const sentiment = (pos - neg) / total;
  if (sentiment >= 0.16) return '偏进攻';
  if (sentiment <= -0.08) return '偏防守';
  return '均衡';
};

const pickFundForBucket = (
  funds: FundUniverseItem[],
  terms: string[],
  profile: '进攻' | '均衡' | '防守',
  bucketIntent: AllocationBucketIntent,
): FundRecommendationItem | null => {
  if (!funds.length) return null;

  const target = terms.join('/');
  const syntheticDirection: 'positive' | 'mixed' | 'negative' =
    profile === '进攻' ? 'positive' : profile === '防守' ? 'negative' : 'mixed';

  const scored = funds
    .map((fund) => {
      const fit = scoreBucketIntentFit(fund, bucketIntent);
      const score = scoreFundForTarget(fund, target, syntheticDirection, 0.68);
      return { fund, score: score + fit.fit * 1.15 - (fit.mismatch ? 1.25 : 0), fit };
    })
    .filter((x) => (requiresStrictBucketMatch(bucketIntent) ? !x.fit.mismatch : true))
    .filter((x) => x.score > 0.2)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  const winner = scored[0];
  return toFundRecommendation(winner.fund, winner.score, target, syntheticDirection, 0.68);
};

const getTemplatesByOutlook = (outlook: '偏进攻' | '均衡' | '偏防守') => {
  if (outlook === '偏进攻') {
    return [
      {
        name: '进攻方案A',
        profile: '进攻' as const,
        expectedScenario: '风险偏好持续修复、成长与主题轮动占优',
        buckets: [
          { assetClass: '权益核心', weight: 55, terms: ['沪深300', '成长', '数字经济'] },
          { assetClass: '主题增强', weight: 20, terms: ['半导体', '芯片', '科技'] },
          { assetClass: '黄金对冲', weight: 10, terms: ['黄金'] },
          { assetClass: '固收缓冲', weight: 15, terms: ['债券', '中债'] },
        ],
      },
      {
        name: '均衡方案B',
        profile: '均衡' as const,
        expectedScenario: '市场分化但主线仍在，需兼顾收益与回撤控制',
        buckets: [
          { assetClass: '权益核心', weight: 40, terms: ['沪深300', '红利', '混合'] },
          { assetClass: '固收底仓', weight: 35, terms: ['债券', '中债', '国债'] },
          { assetClass: '黄金/商品', weight: 15, terms: ['黄金'] },
          { assetClass: '海外补充', weight: 10, terms: ['纳斯达克', 'qdii', '港股'] },
        ],
      },
      {
        name: '防守方案C',
        profile: '防守' as const,
        expectedScenario: '若外部冲击反复，优先防波动和流动性',
        buckets: [
          { assetClass: '固收核心', weight: 55, terms: ['债券', '国债'] },
          { assetClass: '黄金避险', weight: 20, terms: ['黄金'] },
          { assetClass: '低波权益', weight: 20, terms: ['红利', '沪深300'] },
          { assetClass: '战术现金替代', weight: 5, terms: ['短债', '债券'] },
        ],
      },
    ];
  }

  if (outlook === '偏防守') {
    return [
      {
        name: '防守方案A',
        profile: '防守' as const,
        expectedScenario: '经济与流动性预期走弱，先守后攻',
        buckets: [
          { assetClass: '固收核心', weight: 60, terms: ['债券', '国债', '中债'] },
          { assetClass: '黄金避险', weight: 20, terms: ['黄金'] },
          { assetClass: '低波权益', weight: 15, terms: ['红利', '沪深300'] },
          { assetClass: '战术仓位', weight: 5, terms: ['混合'] },
        ],
      },
      {
        name: '均衡方案B',
        profile: '均衡' as const,
        expectedScenario: '若风险偏好阶段性修复，可逐步提权益权重',
        buckets: [
          { assetClass: '权益核心', weight: 35, terms: ['沪深300', '红利'] },
          { assetClass: '固收底仓', weight: 40, terms: ['债券', '中债'] },
          { assetClass: '黄金/商品', weight: 15, terms: ['黄金'] },
          { assetClass: '海外补充', weight: 10, terms: ['纳斯达克', '港股'] },
        ],
      },
      {
        name: '进攻方案C',
        profile: '进攻' as const,
        expectedScenario: '若政策/盈利超预期共振，可升级为进攻仓位',
        buckets: [
          { assetClass: '权益核心', weight: 50, terms: ['成长', '数字经济', '沪深300'] },
          { assetClass: '主题增强', weight: 20, terms: ['半导体', '科技'] },
          { assetClass: '固收缓冲', weight: 20, terms: ['债券'] },
          { assetClass: '黄金对冲', weight: 10, terms: ['黄金'] },
        ],
      },
    ];
  }

  return [
    {
      name: '均衡方案A',
      profile: '均衡' as const,
      expectedScenario: '中性基线：经济修复与波动并存',
      buckets: [
        { assetClass: '权益核心', weight: 45, terms: ['沪深300', '成长', '数字经济'] },
        { assetClass: '固收底仓', weight: 35, terms: ['债券', '中债'] },
        { assetClass: '黄金/商品', weight: 15, terms: ['黄金'] },
        { assetClass: '海外补充', weight: 5, terms: ['纳斯达克', '港股'] },
      ],
    },
    {
      name: '进攻方案B',
      profile: '进攻' as const,
      expectedScenario: '若风险偏好扩张，提升成长主题权重',
      buckets: [
        { assetClass: '权益核心', weight: 55, terms: ['成长', '数字经济', '沪深300'] },
        { assetClass: '主题增强', weight: 20, terms: ['半导体', '芯片', '科技'] },
        { assetClass: '固收缓冲', weight: 15, terms: ['债券'] },
        { assetClass: '黄金对冲', weight: 10, terms: ['黄金'] },
      ],
    },
    {
      name: '防守方案C',
      profile: '防守' as const,
      expectedScenario: '若市场波动放大，切换到防守结构',
      buckets: [
        { assetClass: '固收核心', weight: 50, terms: ['债券', '中债'] },
        { assetClass: '黄金避险', weight: 20, terms: ['黄金'] },
        { assetClass: '低波权益', weight: 25, terms: ['红利', '沪深300'] },
        { assetClass: '战术仓位', weight: 5, terms: ['混合'] },
      ],
    },
  ];
};

const collectDynamicTermsForBucket = (
  assetClass: string,
  baseTerms: string[],
  profile: '进攻' | '均衡' | '防守',
  positiveTargets: string[],
  negativeTargets: string[],
): string[] => {
  const terms = [...baseTerms];
  const assetText = normalize(assetClass);

  if (/主题|权益|进攻/.test(assetText) && positiveTargets.length) {
    terms.push(...positiveTargets.slice(0, 3));
  }
  if (/防守|固收|避险|低波/.test(assetText) && negativeTargets.length) {
    terms.push(...negativeTargets.slice(0, 3));
  }

  if (profile === '进攻' && positiveTargets.length) {
    terms.push(...positiveTargets.slice(0, 2));
  }
  if (profile === '防守' && negativeTargets.length) {
    terms.push(...negativeTargets.slice(0, 2));
  }

  return uniqueStrings(terms).slice(0, 10);
};

const scoreFundForAllocationBucket = (
  fund: FundUniverseItem,
  terms: string[],
  profile: '进攻' | '均衡' | '防守',
  bucketIntent: AllocationBucketIntent,
  reuseCount: number,
  sameManagerCount: number,
  preferred: FundRecommendationItem | null,
) => {
  const syntheticDirection: 'positive' | 'mixed' | 'negative' =
    profile === '进攻' ? 'positive' : profile === '防守' ? 'negative' : 'mixed';
  const target = terms.join('/');
  const baseScore = scoreFundForTarget(fund, target, syntheticDirection, 0.68);
  const { perfScore, sizeScore, riskRank } = computeFundQuality(fund);
  const fit = scoreBucketIntentFit(fund, bucketIntent);

  let riskFit = 0;
  if (profile === '进攻') {
    riskFit = riskRank >= 3 ? 1 : 0.65;
  } else if (profile === '防守') {
    riskFit = riskRank <= 3 ? 1 : 0.55;
  } else {
    riskFit = riskRank >= 2 && riskRank <= 4 ? 1 : 0.72;
  }

  const preferredBoost =
    preferred && preferred.tsCode === fund.tsCode ? 0.45 : 0;
  const repetitionPenalty = Math.min(0.55, reuseCount * 0.16);
  const managerPenalty = Math.min(0.45, sameManagerCount * 0.14);
  const mismatchPenalty = fit.mismatch ? 1.25 : 0;

  return (
    baseScore * 0.55 +
    perfScore * 1.0 +
    sizeScore * 0.55 +
    riskFit * 0.9 +
    fit.fit * 1.2 +
    preferredBoost -
    repetitionPenalty -
    managerPenalty -
    mismatchPenalty
  );
};

export const buildAssetAllocationView = (
  summaryRows: TargetImpactSummary[],
  fundRecs: TargetFundRecommendation[],
  marketView?: Partial<AllocationMarketView>,
  fundUniverse?: FundUniverseItem[],
): AssetAllocationView => {
  const universe = fundUniverse?.length ? fundUniverse : getLocalFundUniverse();

  const outlook =
    marketView?.outlook && ['偏进攻', '均衡', '偏防守'].includes(marketView.outlook)
      ? (marketView.outlook as '偏进攻' | '均衡' | '偏防守')
      : fallbackOutlookFromSummary(summaryRows);

  const templates = getTemplatesByOutlook(outlook);
  const positiveTargets = summaryRows
    .filter((x) => x.direction === 'positive')
    .slice(0, 8)
    .map((x) => x.target);
  const negativeTargets = summaryRows
    .filter((x) => x.direction === 'negative')
    .slice(0, 8)
    .map((x) => x.target);

  const recommendedPool = new Map<string, FundRecommendationItem>();
  fundRecs.forEach((rec) => rec.funds.forEach((f) => recommendedPool.set(f.tsCode, f)));
  const globalFundReuse = new Map<string, number>();
  const globalManagerReuse = new Map<string, number>();

  const plans: AssetAllocationPlan[] = templates.map((tpl) => {
    const selectedInPlan = new Set<string>();
    const selectedManagers = new Map<string, number>();
    const buckets: AllocationBucket[] = tpl.buckets.map((bucket) => {
      const dynamicTerms = collectDynamicTermsForBucket(
        bucket.assetClass,
        bucket.terms,
        tpl.profile,
        positiveTargets,
        negativeTargets,
      );
      const bucketIntent = inferAllocationBucketIntent(bucket.assetClass, dynamicTerms);
      const termNorm = dynamicTerms.map((x) => normalize(x));

      const preferred = Array.from(recommendedPool.values())
        .filter((f) => {
          if (!termNorm.some((k) => normalize(`${f.name} ${f.reason}`).includes(k))) return false;
          const sourceFund = universe.find((u) => u.tsCode === f.tsCode);
          if (!sourceFund) return true;
          return !scoreBucketIntentFit(sourceFund, bucketIntent).mismatch;
        })
        .sort((a, b) => b.matchScore - a.matchScore)[0] || null;

      const topUniverseCandidate = universe
        .map((fund) => ({
          fund,
          fit: scoreBucketIntentFit(fund, bucketIntent),
          score: scoreFundForAllocationBucket(
            fund,
            dynamicTerms,
            tpl.profile,
            bucketIntent,
            globalFundReuse.get(fund.tsCode) || 0,
            (selectedManagers.get(fund.manager || '') || 0) +
              (globalManagerReuse.get(fund.manager || '') || 0),
            preferred,
          ),
        }))
        .filter((x) => (requiresStrictBucketMatch(bucketIntent) ? !x.fit.mismatch : true))
        .filter((x) => !selectedInPlan.has(x.fund.tsCode) && x.score > 0.2)
        .sort((a, b) => b.score - a.score)[0];

      const fund =
        (topUniverseCandidate
          ? toFundRecommendation(
              topUniverseCandidate.fund,
              topUniverseCandidate.score,
              dynamicTerms.join('/'),
              tpl.profile === '进攻'
                ? 'positive'
                : tpl.profile === '防守'
                  ? 'negative'
                  : 'mixed',
              0.68,
            )
          : null) ||
        preferred ||
        pickFundForBucket(universe, dynamicTerms, tpl.profile, bucketIntent);

      if (fund?.tsCode) {
        selectedInPlan.add(fund.tsCode);
        globalFundReuse.set(fund.tsCode, (globalFundReuse.get(fund.tsCode) || 0) + 1);
        const manager = String(fund.manager || '').trim();
        if (manager) {
          selectedManagers.set(manager, (selectedManagers.get(manager) || 0) + 1);
          globalManagerReuse.set(manager, (globalManagerReuse.get(manager) || 0) + 1);
        }
      }

      return {
        assetClass: bucket.assetClass,
        weight: bucket.weight,
        fund,
        note: fund
          ? `候选基金 ${fund.name}（${fund.tsCode}），${fund.reason}；权重依据：主题匹配 + 业绩 + 规模 + 风险适配。`
          : '未在基金池找到高匹配项，建议手动补充同类基金。',
      };
    });

    return {
      name: tpl.name,
      profile: tpl.profile,
      expectedScenario: tpl.expectedScenario,
      buckets,
    };
  });

  return {
    outlook,
    confidence: clamp(Number(marketView?.confidence ?? 0.62), 0.4, 0.95),
    marketView:
      String(marketView?.marketView || '').trim() ||
      '市场处于结构性分化阶段，建议用“核心仓+主题增强+对冲资产”方式提升组合韧性。',
    reasoning:
      String(marketView?.reasoning || '').trim() ||
      '观点综合事件矩阵方向、置信度分布和南方基金样本池的可匹配度生成。',
    llmGenerated: Boolean(marketView?.llmGenerated),
    providerId: marketView?.providerId || '',
    model: marketView?.model || '',
    error: marketView?.error || '',
    plans,
  };
};
