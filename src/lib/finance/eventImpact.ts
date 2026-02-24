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
  rationale: string;
  matchedKeywords: string[];
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

const matchRules = (item: NewsCacheItem) => {
  const text = normalizeText(`${item.title || ''} ${item.content || ''}`);

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
  const confidence = clamp(
    ruleBase * 0.55 + sourceWeight * 0.25 + recencyScore * 0.2 + keywordBoost,
    0.45,
    0.95,
  );

  const rationale = unique(matched.map((x) => x.rule.rationale)).join('；');

  return {
    sectors: allSectors,
    assets: allAssets,
    direction,
    confidence,
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

  for (const item of items) {
    if (!item?.title) continue;

    const matched = matchRules(item);
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
  }

  mapped.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return mapped.slice(0, limit);
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
  lines.push('| 事件 | 影响行业/资产 | 方向 | 置信度 | 说明 |');
  lines.push('| --- | --- | --- | --- | --- |');

  for (const row of rows) {
    const target = unique([...row.sectors, ...row.assets]).slice(0, 5).join('、');
    lines.push(
      `| ${row.event.replace(/\|/g, '\\|')} | ${target} | ${toDisplayDirection(
        row.direction,
      )} | ${(row.confidence * 100).toFixed(0)}% | ${row.rationale.replace(/\|/g, '\\|')} |`,
    );
  }

  lines.push('');
  lines.push('说明：方向与置信度基于新闻关键词映射、来源权重与时效性综合打分。');
  return lines.join('\n');
};
