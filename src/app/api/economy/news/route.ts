import fs from 'fs';
import path from 'node:path';
import {
  aggregateNewsDetailed,
  getNewsSourceHealth,
  type NewsSourceHealth,
  type NewsItem,
  type NewsSourceStat,
} from '@/lib/economy/news-sources';
import { recordCacheObservation } from '@/lib/cache/observability';

type NewsCache = {
  updatedAt: number;
  slot: string;
  data: NewsItem[];
  sourceStats?: NewsSourceStat[];
  sourceHealth?: NewsSourceHealth[];
  totalFetched?: number;
  dedupedCount?: number;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
// NOTE: keep separate from /api/news/finance cache format to avoid conflicts.
const NEWS_CACHE_PATH = path.join(DATA_DIR, '/data/economy-news-cache.json');

const pad = (n: number) => String(n).padStart(2, '0');

// 6小时档位：0/6/12/18 点
const getSixHourSlotLabel = (d: Date) => {
  const local = new Date(d.getTime());
  const slotHour = local.getHours() - (local.getHours() % 6);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(slotHour)}`;
};

const loadCache = (): NewsCache | null => {
  try {
    if (!fs.existsSync(NEWS_CACHE_PATH)) return null;
    const raw = fs.readFileSync(NEWS_CACHE_PATH, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as NewsCache;
    if (!parsed || typeof parsed.updatedAt !== 'number') return null;
    return parsed;
  } catch (err) {
    console.error('Failed to read news cache file:', err);
    return null;
  }
};

const saveCache = (
  data: NewsItem[],
  slot: string,
  sourceStats: NewsSourceStat[],
  sourceHealth: NewsSourceHealth[],
  totalFetched: number,
  dedupedCount: number,
) => {
  try {
    const dir = path.dirname(NEWS_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cache: NewsCache = {
      updatedAt: Date.now(),
      slot,
      data,
      sourceStats,
      sourceHealth,
      totalFetched,
      dedupedCount,
    };
    fs.writeFileSync(NEWS_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Failed to write news cache file:', err);
  }
};

export const GET = async () => {
  try {
    // 检查缓存
    const cached = loadCache();
    const now = new Date();
    const slot = getSixHourSlotLabel(now);
    const recomputeStart = Date.now();

    if (cached && cached.slot === slot) {
      console.log('✓ Using cached news data');
      recordCacheObservation({
        module: 'economy_news',
        slot,
        cached: true,
        sampleSize: cached.data.length,
      });
      return Response.json({
        ok: true,
        success: true,
        data: cached.data,
        items: cached.data,
        cached: true,
        updatedAt: cached.updatedAt,
        slot: cached.slot,
        count: cached.data.length,
        totalFetched: cached.totalFetched ?? cached.data.length,
        dedupedCount: cached.dedupedCount ?? cached.data.length,
        sourceStats: cached.sourceStats || [],
        sourceHealth: cached.sourceHealth || getNewsSourceHealth(),
      });
    }

    // 抓取新闻
    console.log('⟳ Fetching fresh news from all sources...');
    const detailed = await aggregateNewsDetailed();
    const sourceHealth = getNewsSourceHealth();
    const news = detailed.items;

    // 保存缓存
    saveCache(
      news,
      slot,
      detailed.sourceStats,
      sourceHealth,
      detailed.totalFetched,
      detailed.dedupedCount,
    );
    recordCacheObservation({
      module: 'economy_news',
      slot,
      cached: false,
      sampleSize: news.length,
      recomputeMs: Date.now() - recomputeStart,
    });

    return Response.json({
      ok: true,
      success: true,
      data: news,
      items: news,
      cached: false,
      updatedAt: Date.now(),
      slot,
      count: news.length,
      totalFetched: detailed.totalFetched,
      dedupedCount: detailed.dedupedCount,
      sourceStats: detailed.sourceStats,
      sourceHealth,
    });
  } catch (error) {
    console.error('Error in /api/economy/news:', error);
    recordCacheObservation({
      module: 'economy_news',
      slot: getSixHourSlotLabel(new Date()),
      cached: false,
      sampleSize: 0,
    });
    return Response.json(
      {
        ok: false,
        success: false,
        error: 'Failed to fetch news',
        data: [],
        items: [],
        sourceStats: [],
        sourceHealth: getNewsSourceHealth(),
        count: 0,
      },
      { status: 500 },
    );
  }
};
