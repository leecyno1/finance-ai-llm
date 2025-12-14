import fs from 'fs';
import path from 'node:path';

import { aggregateNews } from '@/lib/economy/news-sources';

type FinanceNewsItem = {
  title: string;
  content: string;
  url: string;
  source: string;
  datetime: string;
  channels?: string;
};

type NewsCache = {
  updatedAt: string;
  items: FinanceNewsItem[];
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_PATH = path.join(DATA_DIR, 'data/news-cache.json');

const FALLBACK_NEWS: FinanceNewsItem[] = [
  {
    title: '示例：A股收盘涨跌不一，权重股与成长股分化',
    content:
      '示例数据：用于展示财经快讯效果，实际数据需在本地配置好 Tushare Token 或新闻源后获取实时新闻。',
    url: 'https://finance.sina.com.cn',
    source: 'demo',
    datetime: '',
  },
  {
    title: '示例：美股三大指数震荡，科技股波动加剧',
    content: '示例数据：宏观政策与利率预期变化，对全球股市造成一定扰动。',
    url: 'https://www.wsj.com',
    source: 'demo',
    datetime: '',
  },
  {
    title: '示例：恒生指数全天走强，南向资金净流入',
    content: '示例数据：港股科技与医药板块表现活跃，成交放量明显回升。',
    url: 'https://www.wallstreetcn.com',
    source: 'demo',
    datetime: '',
  },
];

const pad = (n: number) => n.toString().padStart(2, '0');

const formatDateTime = (d: Date) => {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 计算新闻快讯的“时间档”，每天 7/13/19 点各取一次：
// - 00:00-06:59 使用前一天 19 点档的数据
// - 07:00-12:59 使用当日 7 点档
// - 13:00-18:59 使用当日 13 点档
// - 19:00-23:59 使用当日 19 点档
const getNewsSlotLabel = (d: Date) => {
  const local = new Date(d.getTime());
  let slotHour: number;

  if (local.getHours() < 7) {
    local.setDate(local.getDate() - 1);
    slotHour = 19;
  } else if (local.getHours() < 13) {
    slotHour = 7;
  } else if (local.getHours() < 19) {
    slotHour = 13;
  } else {
    slotHour = 19;
  }

  const y = local.getFullYear();
  const m = pad(local.getMonth() + 1);
  const day = pad(local.getDate());

  return `${y}-${m}-${day}T${pad(slotHour)}`;
};

const readCache = (): NewsCache | null => {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as NewsCache;
    if (!parsed.updatedAt || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (items: FinanceNewsItem[]) => {
  try {
    const payload: NewsCache = {
      updatedAt: new Date().toISOString(),
      items,
    };
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write news cache', err);
  }
};

// 使用开放新闻源（见 src/lib/economy/news-sources.ts）聚合真实快讯，替代 TuShare 新闻
const fetchFinanceNewsFromOpenSources = async (): Promise<FinanceNewsItem[]> => {
  const aggregated = await aggregateNews();

  // 映射到前端需要的字段
  const mapped = aggregated.map((n) => ({
    title: n.title,
    content: n.summary || n.content || '',
    url: n.sourceUrl || '',
    source: n.source || 'news',
    datetime: n.publishTime || '',
    channels: n.tags?.join(',') ?? '',
  }));

  // 截断到最多 200 条
  let trimmed = mapped.slice(0, 200);

  // 确保不少于 100 条，不足则循环补足
  const baseLen = trimmed.length;
  while (trimmed.length < 100 && baseLen > 0) {
    const needed = Math.min(baseLen, 100 - trimmed.length);
    trimmed = trimmed.concat(trimmed.slice(0, needed));
  }

  return trimmed;
};

export const GET = async () => {
  try {
    // 先读缓存，根据 7/13/19 点时间档判断是否需要刷新
    const cache = readCache();
    const now = new Date();
    const desiredSlot = getNewsSlotLabel(now);

    if (cache) {
      const cacheSlot = getNewsSlotLabel(new Date(cache.updatedAt));
      if (cacheSlot === desiredSlot && cache.items.length >= 100) {
        return Response.json(
          {
            source: 'cache',
            items: cache.items,
          },
          { status: 200 },
        );
      }
    }

    const items = await fetchFinanceNewsFromOpenSources();

    if (items.length) {
      writeCache(items);
      return Response.json(
        {
          source: 'open-sources',
          items,
        },
        { status: 200 },
      );
    }

    // 没有 Tushare 权限或调用失败时的兜底数据
    return Response.json(
      {
        source: 'fallback',
        items: FALLBACK_NEWS,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in /api/news/finance route:', err);
    return Response.json(
      {
        source: 'error',
        items: FALLBACK_NEWS,
      },
      { status: 500 },
    );
  }
};
