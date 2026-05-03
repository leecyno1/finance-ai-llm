import fs from 'fs';
import path from 'node:path';

export type NewsCacheItem = {
  title: string;
  content?: string;
  url?: string;
  source?: string;
  datetime?: string;
  channels?: string;
};

export type ImpactDirection = 'positive' | 'negative' | 'mixed' | 'neutral';

export type EventImpactItem = {
  event: string;
  source: string;
  sourceUrl: string;
  timestamp: string;
  sectors: string[];
  assets: string[];
  direction: ImpactDirection;
  confidence: number;
  importanceScore: number;
  rationale: string;
  matchedKeywords: string[];
};

export type TargetImpactSummary = {
  target: string;
  positiveWeight: number;
  mixedWeight: number;
  negativeWeight: number;
  direction: 'positive' | 'mixed' | 'negative';
  confidence: number;
  eventCount: number;
  totalWeight: number;
  compositeScore: number;
  scoreBreakdown: {
    confidence: number;
    eventCoverage: number;
    signalClarity: number;
  };
};

export type KeyEventExample = {
  title: string;
  source: string;
  sourceUrl: string;
  timestamp: string;
  direction: ImpactDirection;
  confidence: number;
  importanceScore: number;
};

export type KeyEventInsight = {
  rank: number;
  themeKey: string;
  title: string;
  direction: ImpactDirection;
  confidence: number;
  importanceScore: number;
  compositeScore: number;
  articleCount: number;
  sourceCount: number;
  sentiment: {
    positive: number;
    negative: number;
    mixed: number;
    neutral: number;
  };
  targets: string[];
  rationale: string;
  examples: KeyEventExample[];
  scoreBreakdown: {
    eventStrength: number;
    coverage: number;
    directionClarity: number;
    recency: number;
  };
};

type ImpactRule = {
  id: string;
  keywords: string[];
  sectors: string[];
  assets: string[];
  direction: ImpactDirection;
  rationale: string;
  baseConfidence: number;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const NEWS_CACHE_PATH = path.join(DATA_DIR, 'data/news-cache.json');

const SOURCE_WEIGHT: Record<string, number> = {
  '华尔街见闻': 0.85,
  '财联社': 0.82,
  '东方财富': 0.78,
  '第一财经': 0.78,
  '新浪财经': 0.74,
  '雪球': 0.72,
  '同花顺': 0.72,
};

const IMPACT_RULES: ImpactRule[] = [
  {
    id: 'fed_hawkish',
    keywords: ['美联储', '加息', 'hawkish', 'higher for longer', '缩表'],
    sectors: ['成长科技', '高估值板块', '银行'],
    assets: ['纳斯达克100', '美债长端', '美元指数'],
    direction: 'negative',
    rationale: '偏鹰政策抬升贴现率，通常压制高估值资产并推升美元。',
    baseConfidence: 0.68,
  },
  {
    id: 'fed_dovish',
    keywords: ['降息', 'dovish', '宽松', '流动性宽松', '降准'],
    sectors: ['成长科技', '可选消费', '地产链'],
    assets: ['纳斯达克100', '黄金', '长久期国债'],
    direction: 'positive',
    rationale: '流动性宽松有利风险资产估值扩张，利好成长与贵金属。',
    baseConfidence: 0.7,
  },
  {
    id: 'inflation_up',
    keywords: ['通胀', 'cpi高于预期', 'ppi回升', '通胀反弹'],
    sectors: ['能源', '公用事业', '必选消费'],
    assets: ['原油', '黄金', '美债长端'],
    direction: 'mixed',
    rationale: '通胀上行通常利好实物资产，但对长久期债券和成长估值不利。',
    baseConfidence: 0.66,
  },
  {
    id: 'china_property_weak',
    keywords: ['房地产下行', '新开工下滑', '销售面积下滑', '房价下跌'],
    sectors: ['地产链', '建材', '银行'],
    assets: ['A股地产板块', '中资高收益债', '铁矿石'],
    direction: 'negative',
    rationale: '地产走弱会压制内需链条与信用扩张预期。',
    baseConfidence: 0.71,
  },
  {
    id: 'china_property_rebound',
    keywords: ['楼市回暖', '地产销售回升', '政策托底地产', '房地产企稳'],
    sectors: ['地产链', '家电', '建材'],
    assets: ['A股地产板块', '港股内房', '黑色系商品'],
    direction: 'positive',
    rationale: '地产企稳改善信用与内需预期，提振地产产业链估值。',
    baseConfidence: 0.7,
  },
  {
    id: 'geopolitical_risk',
    keywords: ['地缘冲突', '制裁', '战争', '红海', '中东局势'],
    sectors: ['军工', '能源', '航运'],
    assets: ['原油', '黄金', 'VIX'],
    direction: 'mixed',
    rationale: '地缘风险抬升风险溢价，避险资产受益而风险资产承压。',
    baseConfidence: 0.74,
  },
  {
    id: 'ai_boom',
    keywords: ['AI', '人工智能', '大模型', '算力', '芯片', 'gpu'],
    sectors: ['半导体', '云计算', '软件服务'],
    assets: ['纳斯达克100', '费城半导体指数', '中概AI链'],
    direction: 'positive',
    rationale: 'AI 资本开支与盈利预期提升，驱动科技链估值与业绩预期。',
    baseConfidence: 0.69,
  },
  {
    id: 'oil_supply_shock',
    keywords: ['减产', 'opec', '原油供应收紧', '库存下降'],
    sectors: ['油气开采', '炼化', '航空'],
    assets: ['布伦特原油', 'WTI原油', '航空股'],
    direction: 'mixed',
    rationale: '供应收紧推升油价，利好上游但提高下游成本。',
    baseConfidence: 0.67,
  },
  {
    id: 'earnings_beat',
    keywords: ['业绩超预期', '利润增长', '营收增长', '上调指引', '净利润同比增长'],
    sectors: ['成长科技', '高端制造', '可选消费'],
    assets: ['A股核心成长', '纳斯达克100', '中证1000'],
    direction: 'positive',
    rationale: '企业盈利上修通常支撑估值与风险偏好。',
    baseConfidence: 0.68,
  },
  {
    id: 'earnings_miss',
    keywords: ['业绩不及预期', '利润下滑', '下调指引', '亏损扩大'],
    sectors: ['可选消费', '成长科技', '中小市值'],
    assets: ['纳斯达克100', '中证1000', '港股科技'],
    direction: 'negative',
    rationale: '盈利预期下修会压制风险资产表现。',
    baseConfidence: 0.69,
  },
  {
    id: 'policy_stimulus',
    keywords: ['稳增长', '财政发力', '专项债', '基建投资', '政策支持'],
    sectors: ['基建链', '建材', '工程机械'],
    assets: ['沪深300', '上证50', '黑色系商品'],
    direction: 'positive',
    rationale: '政策刺激改善需求预期并提振顺周期板块。',
    baseConfidence: 0.67,
  },
  {
    id: 'trade_friction',
    keywords: ['关税', '出口受限', '贸易摩擦', '制裁升级'],
    sectors: ['外需链', '电子制造', '航运'],
    assets: ['人民币汇率', '港股出口链', '中概股'],
    direction: 'negative',
    rationale: '外部摩擦抬升不确定性并压制出口链盈利预期。',
    baseConfidence: 0.7,
  },
  {
    id: 'banking_liquidity',
    keywords: ['社融', '信贷', '流动性改善', '货币宽松', '同业利率回落'],
    sectors: ['银行', '地产链', '高股息'],
    assets: ['中证红利', '上证50', '国债期货'],
    direction: 'positive',
    rationale: '信用与流动性改善通常利好金融与高分红资产。',
    baseConfidence: 0.66,
  },
  {
    id: 'risk_off',
    keywords: ['避险', '风险偏好回落', '黑天鹅', '市场波动加剧', '抛售'],
    sectors: ['高贝塔成长', '可选消费', '中小盘'],
    assets: ['黄金', '国债', '美元指数'],
    direction: 'negative',
    rationale: '风险偏好回落阶段，避险资产相对占优。',
    baseConfidence: 0.72,
  },
];

const KEY_EVENT_THEMES: Array<{
  id: string;
  title: string;
  rationale: string;
  keywords: string[];
}> = [
  {
    id: 'monetary_policy',
    title: '货币政策与利率预期',
    rationale: '利率与流动性预期变化会重定价权益、债券与汇率资产。',
    keywords: ['美联储', '降息', '加息', '缩表', '宽松', '利率', '国债', '流动性'],
  },
  {
    id: 'inflation_growth',
    title: '通胀与增长动能',
    rationale: '通胀和增长预期决定顺周期/防御板块的相对表现。',
    keywords: ['通胀', 'cpi', 'ppi', '增长', '社融', '信贷'],
  },
  {
    id: 'china_policy_property',
    title: '国内政策与地产链',
    rationale: '地产与稳增长政策会影响内需链条和金融风险偏好。',
    keywords: ['房地产', '地产', '稳增长', '专项债', '基建', '销售回升', '房价'],
  },
  {
    id: 'ai_semiconductor',
    title: 'AI 与半导体产业链',
    rationale: 'AI 资本开支和芯片供需预期是成长资产的核心驱动。',
    keywords: ['ai', '人工智能', '芯片', '半导体', '算力', 'gpu', '云计算'],
  },
  {
    id: 'geopolitics_energy',
    title: '地缘风险与能源商品',
    rationale: '地缘事件通过油价与避险情绪影响资产定价。',
    keywords: ['地缘', '冲突', '战争', '制裁', '原油', 'opec', '黄金', '避险'],
  },
  {
    id: 'earnings_valuation',
    title: '业绩与估值修正',
    rationale: '盈利预期上修/下修直接驱动风格轮动与估值重估。',
    keywords: ['业绩', '利润', '营收', '指引', '亏损', '估值'],
  },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeText = (text: string) =>
  (text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const normalizeKeyToken = (value: string) =>
  normalizeText(value)
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

const normalizeEventKey = (row: EventImpactItem) => {
  const url = String(row.sourceUrl || '')
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '');
  if (url) return `url:${url}`;

  const text = String(row.event || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 72);
  return `title:${text}`;
};

const dedupeImpactRows = (rows: EventImpactItem[]) => {
  const bucket = new Map<string, EventImpactItem>();

  for (const row of rows) {
    const key = normalizeEventKey(row);
    const prev = bucket.get(key);
    if (!prev) {
      bucket.set(key, row);
      continue;
    }

    const prevTs = new Date(prev.timestamp || '').getTime();
    const rowTs = new Date(row.timestamp || '').getTime();
    const rowBetter =
      row.importanceScore > prev.importanceScore ||
      (row.importanceScore === prev.importanceScore &&
        (row.confidence > prev.confidence ||
          (row.confidence === prev.confidence &&
            (Number.isFinite(rowTs) ? rowTs : 0) > (Number.isFinite(prevTs) ? prevTs : 0))));

    if (rowBetter) {
      bucket.set(key, row);
    }
  }

  return Array.from(bucket.values());
};

const readNewsCache = (): NewsCacheItem[] => {
  try {
    if (!fs.existsSync(NEWS_CACHE_PATH)) return [];
    const raw = fs.readFileSync(NEWS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { items?: NewsCacheItem[] };
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
};

export const getEventImpactNewsStats = () => {
  const items = readNewsCache();
  const seen = new Set<string>();
  let uniqueCount = 0;

  for (const item of items) {
    const urlKey = normalizeText(String(item.url || '')).replace(/[?#].*$/, '');
    const titleKey = normalizeText(String(item.title || ''))
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .slice(0, 120);
    const key = urlKey ? `url:${urlKey}` : `title:${titleKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueCount += 1;
  }

  return {
    rawCount: items.length,
    uniqueCount,
    duplicateCount: Math.max(0, items.length - uniqueCount),
  };
};

const scoreRecency = (timestamp: string) => {
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return 0.2;
  const ageHours = Math.max(0, (Date.now() - t) / (1000 * 60 * 60));
  if (ageHours <= 2) return 1;
  if (ageHours <= 6) return 0.8;
  if (ageHours <= 12) return 0.65;
  if (ageHours <= 24) return 0.5;
  return 0.3;
};

const DIRECTIONAL_TILT = {
  positive: [
    '上涨',
    '走强',
    '拉升',
    '回暖',
    '改善',
    '增长',
    '超预期',
    '上调',
    '突破',
    '连板',
    '涨停',
    '创新高',
    '企稳',
    '修复',
    'improve',
    'beat',
    'beats',
    'rebound',
    'upgrade',
    'surge',
    'rise',
  ],
  negative: [
    '下跌',
    '走弱',
    '回落',
    '承压',
    '低于预期',
    '不及预期',
    '下滑',
    '收紧',
    '风险',
    '抛售',
    '暴跌',
    '亏损',
    '违约',
    '裁员',
    'downgrade',
    'miss',
    'drop',
    'fall',
    'slump',
    'decline',
  ],
};

const applyDirectionalTilt = (
  text: string,
  direction: ImpactDirection,
  confidence: number,
) => {
  const normalized = normalizeText(text);
  const posHit = DIRECTIONAL_TILT.positive.reduce(
    (acc, kw) => (normalized.includes(kw) ? acc + 1 : acc),
    0,
  );
  const negHit = DIRECTIONAL_TILT.negative.reduce(
    (acc, kw) => (normalized.includes(kw) ? acc + 1 : acc),
    0,
  );
  const bias = posHit - negHit;

  if (direction === 'mixed' || direction === 'neutral') {
    if (bias >= 1) {
      return {
        direction: 'positive' as ImpactDirection,
        confidence: clamp(confidence + Math.min(0.08, bias * 0.03), 0.45, 0.95),
      };
    }
    if (bias <= -1) {
      return {
        direction: 'negative' as ImpactDirection,
        confidence: clamp(confidence + Math.min(0.08, Math.abs(bias) * 0.03), 0.45, 0.95),
      };
    }
  }

  if (direction === 'positive' && bias <= -2) {
    return {
      direction: 'mixed' as ImpactDirection,
      confidence: clamp(confidence - 0.05, 0.45, 0.95),
    };
  }
  if (direction === 'negative' && bias >= 2) {
    return {
      direction: 'mixed' as ImpactDirection,
      confidence: clamp(confidence - 0.05, 0.45, 0.95),
    };
  }

  return { direction, confidence };
};

const FALLBACK_NEUTRAL_MAP: Array<{
  keywords: string[];
  sectors: string[];
  assets: string[];
  direction: ImpactDirection;
  rationale: string;
  baseConfidence: number;
}> = [
  {
    keywords: ['半导体', '芯片', '算力', '服务器'],
    sectors: ['半导体', '科技硬件'],
    assets: ['费城半导体指数', '科创50'],
    direction: 'positive',
    rationale: '科技产业链热度提升，相关板块交易活跃。',
    baseConfidence: 0.61,
  },
  {
    keywords: ['电动车', '锂电', '新能源', '光伏'],
    sectors: ['新能源', '高端制造'],
    assets: ['新能源车链', '创业板指数'],
    direction: 'mixed',
    rationale: '新能源链条受政策和价格双因素影响，阶段性分化明显。',
    baseConfidence: 0.6,
  },
  {
    keywords: ['消费', '零售', '白酒', '旅游'],
    sectors: ['消费', '社服'],
    assets: ['中证消费', '旅游出行板块'],
    direction: 'mixed',
    rationale: '消费板块受需求修复节奏影响，结构轮动较快。',
    baseConfidence: 0.59,
  },
  {
    keywords: ['银行', '保险', '券商', '信贷'],
    sectors: ['金融'],
    assets: ['上证50', '中证红利'],
    direction: 'positive',
    rationale: '金融板块与流动性、风险偏好共振显著。',
    baseConfidence: 0.6,
  },
  {
    keywords: ['黄金', '金价', '期金', '贵金属'],
    sectors: ['贵金属', '避险资产'],
    assets: ['黄金', '沪金', '黄金ETF'],
    direction: 'positive',
    rationale: '避险需求上升通常推动贵金属资产表现。',
    baseConfidence: 0.63,
  },
  {
    keywords: ['原油', '布伦特', 'wti', '油轮', 'opec', '天然气'],
    sectors: ['能源', '油气'],
    assets: ['布伦特原油', 'WTI原油', '能源股'],
    direction: 'mixed',
    rationale: '能源价格波动会在上游受益与下游成本压力之间形成分化。',
    baseConfidence: 0.62,
  },
  {
    keywords: ['比特币', 'btc', '加密', 'crypto'],
    sectors: ['数字资产', '风险偏好'],
    assets: ['比特币', '加密资产', '高波动成长'],
    direction: 'mixed',
    rationale: '加密资产反映高风险偏好变化，波动通常较大。',
    baseConfidence: 0.59,
  },
  {
    keywords: ['地缘', '冲突', '战争', '中东', '伊朗', '以军', '制裁'],
    sectors: ['军工', '能源', '航运'],
    assets: ['黄金', '原油', '军工指数'],
    direction: 'negative',
    rationale: '地缘冲突通常抬升风险溢价，对高贝塔资产形成压制。',
    baseConfidence: 0.65,
  },
  {
    keywords: ['债', '国债', '科创债', '收益率', '利率'],
    sectors: ['利率敏感', '金融'],
    assets: ['国债', '中债', '债券基金'],
    direction: 'positive',
    rationale: '债券与利率信号可为组合提供防守与估值锚定作用。',
    baseConfidence: 0.61,
  },
];

const inferFallbackImpact = (item: NewsCacheItem) => {
  const fullText = `${item.title || ''} ${item.content || ''}`;
  const text = normalizeText(fullText);
  const hit = FALLBACK_NEUTRAL_MAP.find((rule) =>
    rule.keywords.some((kw) => text.includes(kw.toLowerCase())),
  );
  if (!hit) return null;

  const sourceWeight = SOURCE_WEIGHT[item.source || ''] ?? 0.62;
  const recencyScore = scoreRecency(item.datetime || '');
  const confidenceRaw = clamp(
    hit.baseConfidence * 0.6 + sourceWeight * 0.2 + recencyScore * 0.2,
    0.5,
    0.88,
  );
  const tilted = applyDirectionalTilt(fullText, hit.direction, confidenceRaw);

  return {
    sectors: hit.sectors,
    assets: hit.assets,
    direction: tilted.direction,
    confidence: tilted.confidence,
    rationale: hit.rationale,
    matchedKeywords: hit.keywords.filter((kw) => text.includes(kw.toLowerCase())),
  };
};

const computeImportanceScore = (
  confidence: number,
  source: string,
  timestamp: string,
  keywordCount: number,
) => {
  const sourceWeight = SOURCE_WEIGHT[source || ''] ?? 0.62;
  const recency = scoreRecency(timestamp || '');
  const keywordStrength = clamp(keywordCount / 6, 0, 1);
  const score =
    confidence * 0.52 + sourceWeight * 0.2 + recency * 0.18 + keywordStrength * 0.1;
  return Number(clamp(score, 0.45, 0.98).toFixed(2));
};

const buildGenericSupplement = (item: NewsCacheItem): EventImpactItem => {
  const confidence = 0.54;
  const importance = computeImportanceScore(
    confidence,
    item.source || '',
    item.datetime || '',
    1,
  );

  return {
    event: item.title,
    source: item.source || 'news',
    sourceUrl: item.url || '',
    timestamp: item.datetime || '',
    sectors: ['市场情绪', '流动性预期'],
    assets: ['沪深300', '中证全指'],
    direction: 'mixed',
    confidence,
    importanceScore: importance,
    rationale: '该事件被纳入市场情绪与流动性跟踪，用于补充事件覆盖面。',
    matchedKeywords: ['市场情绪'],
  };
};

const matchRules = (item: NewsCacheItem) => {
  const fullText = `${item.title || ''} ${item.content || ''}`;
  const text = normalizeText(fullText);

  const matched = IMPACT_RULES.map((rule) => {
    const matchedKeywords = rule.keywords.filter((kw) =>
      text.includes(kw.toLowerCase()),
    );
    return { rule, matchedKeywords };
  }).filter((x) => x.matchedKeywords.length > 0);

  if (matched.length === 0) return null;

  const allSectors = unique(matched.flatMap((x) => x.rule.sectors));
  const allAssets = unique(matched.flatMap((x) => x.rule.assets));
  const allKeywords = unique(matched.flatMap((x) => x.matchedKeywords));

  const dirSet = new Set(matched.map((x) => x.rule.direction));
  const direction: ImpactDirection = dirSet.size === 1
    ? (matched[0]?.rule.direction ?? 'neutral')
    : 'mixed';

  const sourceWeight = SOURCE_WEIGHT[item.source || ''] ?? 0.62;
  const recencyScore = scoreRecency(item.datetime || '');
  const ruleBase =
    matched.reduce((acc, cur) => acc + cur.rule.baseConfidence, 0) /
    Math.max(1, matched.length);

  const keywordBoost = Math.min(0.2, allKeywords.length * 0.03);
  const confidenceRaw = clamp(
    ruleBase * 0.55 + sourceWeight * 0.25 + recencyScore * 0.2 + keywordBoost,
    0.45,
    0.95,
  );
  const tilted = applyDirectionalTilt(fullText, direction, confidenceRaw);

  const rationale = unique(matched.map((x) => x.rule.rationale)).join('；');

  return {
    sectors: allSectors,
    assets: allAssets,
    direction: tilted.direction,
    confidence: tilted.confidence,
    rationale,
    matchedKeywords: allKeywords,
  };
};

const toDisplayDirection = (direction: ImpactDirection) => {
  if (direction === 'positive') return '利多';
  if (direction === 'negative') return '利空';
  if (direction === 'mixed') return '分化';
  return '中性';
};

export const buildEventImpactMatrix = (opts?: {
  limit?: number;
  query?: string;
}) => {
  const limit = opts?.limit ?? 20;
  const query = normalizeText(opts?.query || '');

  const items = readNewsCache();

  const mapped: EventImpactItem[] = [];
  const usedKeys = new Set<string>();

  for (const item of items) {
    if (!item?.title) continue;

    const matched = matchRules(item) || inferFallbackImpact(item);
    if (!matched) continue;

    const payload: EventImpactItem = {
      event: item.title,
      source: item.source || 'news',
      sourceUrl: item.url || '',
      timestamp: item.datetime || '',
      sectors: matched.sectors,
      assets: matched.assets,
      direction: matched.direction,
      confidence: Number(matched.confidence.toFixed(2)),
      importanceScore: computeImportanceScore(
        matched.confidence,
        item.source || '',
        item.datetime || '',
        matched.matchedKeywords.length,
      ),
      rationale: matched.rationale,
      matchedKeywords: matched.matchedKeywords,
    };

    if (query) {
      const hay = normalizeText(
        `${payload.event} ${payload.sectors.join(' ')} ${payload.assets.join(' ')}`,
      );
      if (!hay.includes(query)) continue;
    }

    mapped.push(payload);
    usedKeys.add(normalizeEventKey(payload));
  }

  if (mapped.length < 5) {
    const supplements = items
      .filter((item) => item?.title)
      .map((item) => buildGenericSupplement(item))
      .filter((row) => {
        const key = normalizeEventKey(row);
        if (usedKeys.has(key)) return false;
        usedKeys.add(key);
        return true;
      })
      .sort((a, b) => {
        if (b.importanceScore !== a.importanceScore) return b.importanceScore - a.importanceScore;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, 5 - mapped.length);

    mapped.push(...supplements);
  }

  const deduped = dedupeImpactRows(mapped);

  deduped.sort((a, b) => {
    if (b.importanceScore !== a.importanceScore) return b.importanceScore - a.importanceScore;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return deduped.slice(0, limit);
};

export const buildTargetImpactSummary = (
  rows: EventImpactItem[],
): TargetImpactSummary[] => {
  const pickTargetsFromRow = (row: EventImpactItem) => {
    const sectorTargets = unique(
      (row.sectors || []).map((x) => String(x || '').trim()).filter((x) => x.length >= 2),
    ).slice(0, 4);
    const assetTargets = unique(
      (row.assets || []).map((x) => String(x || '').trim()).filter((x) => x.length >= 2),
    )
      .filter((x) => !/vix|美元指数|美债长端/i.test(x))
      .slice(0, 2);

    if (sectorTargets.length) {
      return unique([...sectorTargets, ...assetTargets]).slice(0, 6);
    }
    return assetTargets.slice(0, 4);
  };

  type SummaryAccumulator = {
    positiveWeight: number;
    mixedWeight: number;
    negativeWeight: number;
    events: Set<string>;
  };

  const acc = new Map<string, SummaryAccumulator>();

  for (const row of rows) {
    const targets = pickTargetsFromRow(row);
    if (!targets.length) continue;

    const baseWeight = clamp(row.confidence || 0.5, 0.45, 0.95);
    const keywordBoost = Math.min(0.15, (row.matchedKeywords?.length || 0) * 0.03);
    const weight = clamp(baseWeight + keywordBoost, 0.45, 1);
    const eventKey = normalizeEventKey(row);

    for (const target of targets) {
      const key = target.trim();
      if (!key) continue;
      const prev = acc.get(key) || {
        positiveWeight: 0,
        mixedWeight: 0,
        negativeWeight: 0,
        events: new Set<string>(),
      };

      if (row.direction === 'positive') {
        prev.positiveWeight += weight;
      } else if (row.direction === 'negative') {
        prev.negativeWeight += weight;
      } else if (row.direction === 'mixed') {
        prev.mixedWeight += weight;
      } else {
        // Neutral events carry lower conviction, treated as weak mixed signal.
        prev.mixedWeight += weight * 0.5;
      }

      prev.events.add(eventKey);
      acc.set(key, prev);
    }
  }

  const out: TargetImpactSummary[] = [];
  for (const [target, v] of acc.entries()) {
    const totalWeight = v.positiveWeight + v.mixedWeight + v.negativeWeight;
    if (totalWeight <= 0) continue;

    const dominant = Math.max(v.positiveWeight, v.mixedWeight, v.negativeWeight);
    const dominance = dominant / totalWeight;
    const eventCount = v.events.size;

    const posShare = v.positiveWeight / totalWeight;
    const negShare = v.negativeWeight / totalWeight;
    const mixShare = v.mixedWeight / totalWeight;
    const netBias = posShare - negShare;

    let direction: 'positive' | 'mixed' | 'negative' = 'mixed';
    if (netBias >= 0.06 || (v.positiveWeight >= v.mixedWeight * 1.02 && posShare >= 0.33)) {
      direction = 'positive';
    } else if (netBias <= -0.06 || (v.negativeWeight >= v.mixedWeight * 1.02 && negShare >= 0.33)) {
      direction = 'negative';
    } else if (mixShare < 0.58 && posShare > negShare) {
      direction = 'positive';
    } else if (mixShare < 0.58 && negShare > posShare) {
      direction = 'negative';
    }

    const coverageBoost = Math.min(0.18, Math.log2(1 + eventCount) * 0.06);
    const directionalBoost = Math.min(0.08, Math.abs(netBias) * 0.2);
    const confidence = clamp(0.45 + dominance * 0.38 + coverageBoost + directionalBoost, 0.45, 0.95);
    const eventCoverageScore = clamp(Math.log2(1 + eventCount) / 3, 0, 1);
    const confidenceScore = clamp(confidence, 0, 1);
    const signalClarityScore = clamp(dominance, 0, 1);
    const compositeScore = clamp(
      confidenceScore * 0.5 + eventCoverageScore * 0.25 + signalClarityScore * 0.25,
      0.45,
      0.98,
    );

    out.push({
      target,
      positiveWeight: Number(v.positiveWeight.toFixed(2)),
      mixedWeight: Number(v.mixedWeight.toFixed(2)),
      negativeWeight: Number(v.negativeWeight.toFixed(2)),
      direction,
      confidence: Number(confidence.toFixed(2)),
      eventCount,
      totalWeight: Number(totalWeight.toFixed(2)),
      compositeScore: Number((compositeScore * 100).toFixed(1)),
      scoreBreakdown: {
        confidence: Number((confidenceScore * 100).toFixed(1)),
        eventCoverage: Number((eventCoverageScore * 100).toFixed(1)),
        signalClarity: Number((signalClarityScore * 100).toFixed(1)),
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

const resolveKeyEventTheme = (row: EventImpactItem) => {
  const text = normalizeText(
    `${row.event} ${row.rationale} ${row.matchedKeywords.join(' ')} ${row.sectors.join(' ')} ${row.assets.join(' ')}`,
  );

  let best: (typeof KEY_EVENT_THEMES)[number] | null = null;
  let bestHit = 0;

  for (const theme of KEY_EVENT_THEMES) {
    const hit = theme.keywords.reduce((acc, kw) => {
      const token = normalizeText(kw);
      return token && text.includes(token) ? acc + 1 : acc;
    }, 0);
    if (hit > bestHit) {
      bestHit = hit;
      best = theme;
    }
  }

  if (best && bestHit > 0) {
    return {
      themeKey: best.id,
      title: best.title,
      rationale: best.rationale,
    };
  }

  const fallbackToken =
    row.matchedKeywords[0] || row.sectors[0] || row.assets[0] || '市场信号';
  const fallbackKey = normalizeKeyToken(fallbackToken) || 'market_signal';
  return {
    themeKey: `fallback_${fallbackKey}`,
    title: `${fallbackToken}相关事件`,
    rationale: row.rationale || '该主题由相关新闻聚合形成，需要结合更多样本持续跟踪。',
  };
};

const buildKeyEventPrototype = (
  row: EventImpactItem,
  theme: ReturnType<typeof resolveKeyEventTheme>,
) => {
  const normalizedSignals = unique(
    (row.matchedKeywords || [])
      .map((x) => String(x || '').trim())
      .filter((x) => x.length >= 2),
  );
  const normalizedTargets = unique(
    [...row.sectors, ...row.assets]
      .map((x) => String(x || '').trim())
      .filter((x) => x.length >= 2),
  );
  const signal = normalizedSignals[0] || normalizedTargets[0] || row.event || '市场信号';
  const signalKey = normalizeKeyToken(signal) || 'signal';
  const prototypeKey = `${theme.themeKey}::${row.direction}::${signalKey}`;
  const title = `${theme.title} · ${signal}`;

  return {
    prototypeKey,
    title,
    rationale:
      row.rationale || theme.rationale,
  };
};

export const buildKeyEventInsights = (
  rows: EventImpactItem[],
  opts?: { limit?: number },
): KeyEventInsight[] => {
  const limit = Math.max(1, Math.min(10, opts?.limit ?? 5));
  if (!rows.length) return [];

  const bucket = new Map<
    string,
    {
      title: string;
      rationale: string;
      rows: EventImpactItem[];
    }
  >();

  for (const row of rows) {
    const theme = resolveKeyEventTheme(row);
    const prototype = buildKeyEventPrototype(row, theme);
    const prev = bucket.get(prototype.prototypeKey) || {
      title: prototype.title,
      rationale: prototype.rationale,
      rows: [],
    };
    prev.rows.push(row);
    bucket.set(prototype.prototypeKey, prev);
  }

  const insights = Array.from(bucket.entries()).map(([themeKey, group]) => {
    const articleCount = group.rows.length;
    const sourceSet = new Set(group.rows.map((r) => normalizeText(r.source)));
    const sourceCount = sourceSet.size;

    const sentiment = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
    let posWeight = 0;
    let negWeight = 0;
    let mixWeight = 0;
    let neuWeight = 0;
    let importanceSum = 0;
    let confidenceSum = 0;
    let recencySum = 0;

    const targetCounter = new Map<string, number>();
    for (const row of group.rows) {
      sentiment[row.direction] += 1;
      const w = Math.max(0.01, row.importanceScore * row.confidence);
      if (row.direction === 'positive') posWeight += w;
      else if (row.direction === 'negative') negWeight += w;
      else if (row.direction === 'mixed') mixWeight += w;
      else neuWeight += w;

      importanceSum += row.importanceScore;
      confidenceSum += row.confidence;
      recencySum += scoreRecency(row.timestamp);

      unique([...row.sectors, ...row.assets]).forEach((t) => {
        if (!t) return;
        targetCounter.set(t, (targetCounter.get(t) || 0) + 1);
      });
    }

    const totalWeight = posWeight + negWeight + mixWeight + neuWeight;
    let direction: ImpactDirection = 'mixed';
    let dominantWeight = mixWeight;
    if (posWeight >= negWeight && posWeight >= mixWeight && posWeight >= neuWeight) {
      direction = 'positive';
      dominantWeight = posWeight;
    } else if (negWeight >= posWeight && negWeight >= mixWeight && negWeight >= neuWeight) {
      direction = 'negative';
      dominantWeight = negWeight;
    } else if (neuWeight > mixWeight && neuWeight >= posWeight && neuWeight >= negWeight) {
      direction = 'neutral';
      dominantWeight = neuWeight;
    }

    const sentimentClarity = totalWeight > 0 ? dominantWeight / totalWeight : 0.5;
    const avgImportance = importanceSum / Math.max(1, articleCount);
    const avgConfidence = confidenceSum / Math.max(1, articleCount);
    const coverageScore =
      clamp(Math.log2(1 + articleCount) / 3, 0, 1) * 0.7 +
      clamp(sourceCount / 4, 0, 1) * 0.3;
    const recencyScore = recencySum / Math.max(1, articleCount);

    const importanceScore = clamp(avgImportance * 0.75 + avgConfidence * 0.25, 0.45, 0.98);
    const confidence = clamp(avgConfidence * 0.6 + sentimentClarity * 0.4, 0.45, 0.95);
    const eventStrength = clamp(importanceScore, 0, 1);
    const directionClarity = clamp(sentimentClarity, 0, 1);
    const compositeScore = clamp(
      eventStrength * 0.4 +
        directionClarity * 0.2 +
        coverageScore * 0.25 +
        recencyScore * 0.15,
      0.45,
      0.99,
    );

    const examples: KeyEventExample[] = [...group.rows]
      .sort((a, b) => {
        if (b.importanceScore !== a.importanceScore) {
          return b.importanceScore - a.importanceScore;
        }
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, 3)
      .map((row) => ({
        title: row.event,
        source: row.source,
        sourceUrl: row.sourceUrl,
        timestamp: row.timestamp,
        direction: row.direction,
        confidence: Number(row.confidence.toFixed(2)),
        importanceScore: Number(row.importanceScore.toFixed(2)),
      }));

    const targets = Array.from(targetCounter.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .slice(0, 6)
      .map(([name]) => name);

    return {
      rank: 0,
      themeKey,
      title: group.title,
      direction,
      confidence: Number(confidence.toFixed(2)),
      importanceScore: Number(importanceScore.toFixed(2)),
      compositeScore: Number((compositeScore * 100).toFixed(1)),
      articleCount,
      sourceCount,
      sentiment,
      targets,
      rationale: group.rationale,
      examples,
      scoreBreakdown: {
        eventStrength: Number((eventStrength * 100).toFixed(1)),
        coverage: Number((coverageScore * 100).toFixed(1)),
        directionClarity: Number((directionClarity * 100).toFixed(1)),
        recency: Number((recencyScore * 100).toFixed(1)),
      },
    } satisfies KeyEventInsight;
  });

  insights.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (b.articleCount !== a.articleCount) return b.articleCount - a.articleCount;
    return b.importanceScore - a.importanceScore;
  });

  const top = insights.slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  if (top.length >= limit) return top;

  const seenEventKeys = new Set<string>();
  const supplements: KeyEventInsight[] = [];
  const supplementRows = [...rows].sort((a, b) => {
    const aScore =
      a.importanceScore * 0.6 +
      a.confidence * 0.3 +
      scoreRecency(a.timestamp) * 0.1;
    const bScore =
      b.importanceScore * 0.6 +
      b.confidence * 0.3 +
      scoreRecency(b.timestamp) * 0.1;
    if (bScore !== aScore) return bScore - aScore;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  for (const row of supplementRows) {
    const rowKey = normalizeEventKey(row);
    if (seenEventKeys.has(rowKey)) continue;
    seenEventKeys.add(rowKey);

    const theme = resolveKeyEventTheme(row);
    const supplementThemeKey = `${theme.themeKey}__${normalizeKeyToken(row.event || row.sourceUrl || row.source || String(supplements.length))}`;
    const rawScore = clamp(
      row.importanceScore * 0.6 +
        row.confidence * 0.25 +
        scoreRecency(row.timestamp) * 0.15,
      0.3,
      0.98,
    );

    supplements.push({
      rank: 0,
      themeKey: supplementThemeKey,
      title: theme.title,
      direction: row.direction,
      confidence: Number(row.confidence.toFixed(2)),
      importanceScore: Number(row.importanceScore.toFixed(2)),
      compositeScore: Number((rawScore * 100).toFixed(1)),
      articleCount: 1,
      sourceCount: row.source ? 1 : 0,
      sentiment: {
        positive: row.direction === 'positive' ? 1 : 0,
        negative: row.direction === 'negative' ? 1 : 0,
        mixed: row.direction === 'mixed' ? 1 : 0,
        neutral: row.direction === 'neutral' ? 1 : 0,
      },
      targets: unique([...row.sectors, ...row.assets]).slice(0, 6),
      rationale: theme.rationale,
      examples: [
        {
          title: row.event,
          source: row.source,
          sourceUrl: row.sourceUrl,
          timestamp: row.timestamp,
          direction: row.direction,
          confidence: row.confidence,
          importanceScore: row.importanceScore,
        },
      ],
      scoreBreakdown: {
        eventStrength: Number((row.importanceScore * 100).toFixed(1)),
        coverage: Number((Math.min(1, row.confidence) * 100).toFixed(1)),
        directionClarity: Number((Math.min(1, row.confidence) * 100).toFixed(1)),
        recency: Number((scoreRecency(row.timestamp) * 100).toFixed(1)),
      },
    });
    if (top.length + supplements.length >= limit) break;
  }

  const enriched = [...top, ...supplements].sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (b.articleCount !== a.articleCount) return b.articleCount - a.articleCount;
    return b.importanceScore - a.importanceScore;
  });

  // Ensure Top5 is always filled when there are source rows.
  if (enriched.length < limit && supplementRows.length) {
    let ptr = 0;
    while (enriched.length < limit && ptr < limit * 3) {
      const row = supplementRows[ptr % supplementRows.length];
      const theme = resolveKeyEventTheme(row);
      const syntheticKey = `synthetic_${ptr}_${normalizeKeyToken(row.event || row.source || 'signal')}`;
      const syntheticScore = clamp(
        row.importanceScore * 0.55 +
          row.confidence * 0.3 +
          scoreRecency(row.timestamp) * 0.15,
        0.3,
        0.95,
      );
      enriched.push({
        rank: 0,
        themeKey: syntheticKey,
        title: `${theme.title} · 补充样本`,
        direction: row.direction,
        confidence: Number(row.confidence.toFixed(2)),
        importanceScore: Number(row.importanceScore.toFixed(2)),
        compositeScore: Number((syntheticScore * 100).toFixed(1)),
        articleCount: 1,
        sourceCount: row.source ? 1 : 0,
        sentiment: {
          positive: row.direction === 'positive' ? 1 : 0,
          negative: row.direction === 'negative' ? 1 : 0,
          mixed: row.direction === 'mixed' ? 1 : 0,
          neutral: row.direction === 'neutral' ? 1 : 0,
        },
        targets: unique([...row.sectors, ...row.assets]).slice(0, 6),
        rationale: theme.rationale,
        examples: [
          {
            title: row.event,
            source: row.source,
            sourceUrl: row.sourceUrl,
            timestamp: row.timestamp,
            direction: row.direction,
            confidence: row.confidence,
            importanceScore: row.importanceScore,
          },
        ],
        scoreBreakdown: {
          eventStrength: Number((row.importanceScore * 100).toFixed(1)),
          coverage: Number((Math.min(1, row.confidence) * 100).toFixed(1)),
          directionClarity: Number((Math.min(1, row.confidence) * 100).toFixed(1)),
          recency: Number((scoreRecency(row.timestamp) * 100).toFixed(1)),
        },
      });
      ptr += 1;
    }
  }

  return enriched.slice(0, limit).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
};

export const formatEventImpactAsMarkdown = (rows: EventImpactItem[]) => {
  if (!rows.length) {
    return [
      '## 事件-资产影响矩阵',
      '',
      '当前未识别到可映射的新闻事件。请先确认财经快讯缓存已更新。',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push('## 事件-资产影响矩阵');
  lines.push('');
  lines.push('| 排名 | 事件 | 影响行业/资产 | 方向 | 重要度 | 置信度 | 说明 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const [idx, row] of rows.entries()) {
    const target = unique([...row.sectors, ...row.assets]).slice(0, 5).join('、');
    lines.push(
      `| ${idx + 1} | ${row.event.replace(/\|/g, '\\|')} | ${target} | ${toDisplayDirection(
        row.direction,
      )} | ${(row.importanceScore * 100).toFixed(0)}% | ${(row.confidence * 100).toFixed(0)}% | ${row.rationale.replace(/\|/g, '\\|')} |`,
    );
  }

  lines.push('');
  lines.push('说明：方向与置信度基于新闻关键词映射、来源权重与时效性综合打分。');
  return lines.join('\n');
};
