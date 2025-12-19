import fs from 'fs';
import path from 'node:path';
import { aggregateNews, type NewsItem } from '@/lib/economy/news-sources';

type NewsCache = {
  updatedAt: number;
  data: NewsItem[];
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
// NOTE: keep separate from /api/news/finance cache format to avoid conflicts.
const NEWS_CACHE_PATH = path.join(DATA_DIR, '/data/economy-news-cache.json');

// 缓存时间：5 分钟
const CACHE_TTL = 5 * 60 * 1000;

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

const saveCache = (data: NewsItem[]) => {
  try {
    const dir = path.dirname(NEWS_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cache: NewsCache = {
      updatedAt: Date.now(),
      data,
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
    const now = Date.now();

    if (cached && now - cached.updatedAt < CACHE_TTL) {
      console.log('✓ Using cached news data');
      return Response.json({
        success: true,
        data: cached.data,
        cached: true,
        updatedAt: cached.updatedAt,
      });
    }

    // 抓取新闻
    console.log('⟳ Fetching fresh news from all sources...');
    const news = await aggregateNews();

    // 保存缓存
    saveCache(news);

    return Response.json({
      success: true,
      data: news,
      cached: false,
      updatedAt: now,
      count: news.length,
    });
  } catch (error) {
    console.error('Error in /api/economy/news:', error);
    return Response.json(
      {
        success: false,
        error: 'Failed to fetch news',
        data: [],
      },
      { status: 500 },
    );
  }
};
