import fs from 'fs';
import path from 'node:path';

import {
  aggregateNewsDetailed,
  getNewsSourceHealth,
  type NewsSourceHealth,
  type NewsSourceStat,
} from '@/lib/economy/news-sources';
import { recordCacheObservation } from '@/lib/cache/observability';

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
  slot?: string;
  items: FinanceNewsItem[];
  sourceStats?: NewsSourceStat[];
  sourceHealth?: NewsSourceHealth[];
  totalFetched?: number;
  dedupedCount?: number;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_PATH = path.join(DATA_DIR, 'data/news-cache.json');

const RSS_FALLBACK_FEEDS = [
  'https://www.chinanews.com.cn/rss/finance.xml',
  'https://www.people.com.cn/rss/finance.xml',
];

const pad = (n: number) => n.toString().padStart(2, '0');

const formatDateTime = (d: Date) => {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 计算新闻快讯的“时间档”，每 6 小时更新一次：0/6/12/18 点。
const getNewsSlotLabel = (d: Date) => {
  const local = new Date(d.getTime());
  const slotHour = local.getHours() - (local.getHours() % 6);

  const y = local.getFullYear();
  const m = pad(local.getMonth() + 1);
  const day = pad(local.getDate());

  return `${y}-${m}-${day}T${pad(slotHour)}`;
};

const fetchWithTimeout = async (
  url: string,
  timeoutMs = 8000,
  headers?: Record<string, string>,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0',
        ...(headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};

const stripCdata = (text: string) =>
  String(text || '').replace(/^<!\[CDATA\[/i, '').replace(/\]\]>$/i, '');

const decodeHtmlEntities = (s: string) =>
  String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripTags = (s: string) =>
  String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeText = (s: string) =>
  decodeHtmlEntities(stripCdata(String(s || '')))
    .replace(/\s+/g, ' ')
    .trim();

const parseRssFinanceItems = (xml: string, sourceName: string): FinanceNewsItem[] => {
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const blocks = xml.match(itemRegex) || [];
  const getTag = (block: string, tag: string) => {
    const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return normalizeText(match?.[1] || '');
  };
  const list: FinanceNewsItem[] = [];

  for (const block of blocks) {
    const title = getTag(block, 'title');
    const link = getTag(block, 'link');
    const descriptionRaw =
      getTag(block, 'description') ||
      getTag(block, 'summary') ||
      getTag(block, 'content:encoded');
    const pubDate = getTag(block, 'pubDate');
    const content = stripTags(descriptionRaw);
    if (!title || !link) continue;
    list.push({
      title,
      content: content || title,
      url: link,
      source: sourceName,
      datetime: pubDate,
    });
  }
  return list;
};

const dedupeByUrl = (items: FinanceNewsItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.url || '').trim().toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchRssFallbackFinanceNews = async (): Promise<FinanceNewsItem[]> => {
  const settled = await Promise.allSettled(
    RSS_FALLBACK_FEEDS.map(async (url) => {
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return [] as FinanceNewsItem[];
      const xml = await res.text();
      const sourceName = url.includes('chinanews') ? '中新网' : '人民网';
      return parseRssFinanceItems(xml, sourceName);
    }),
  );

  const merged = settled
    .filter((x) => x.status === 'fulfilled')
    .flatMap((x) => (x as PromiseFulfilledResult<FinanceNewsItem[]>).value);

  return dedupeByUrl(merged).slice(0, 120);
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

const writeCache = (
  items: FinanceNewsItem[],
  slot: string,
  sourceStats: NewsSourceStat[],
  sourceHealth: NewsSourceHealth[],
  totalFetched: number,
  dedupedCount: number,
) => {
  try {
    const payload: NewsCache = {
      updatedAt: new Date().toISOString(),
      slot,
      items,
      sourceStats,
      sourceHealth,
      totalFetched,
      dedupedCount,
    };
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write news cache', err);
  }
};

const fetchFinanceNewsBundle = async () => {
  const aggregated = await aggregateNewsDetailed();
  const mapped = aggregated.items.map((n) => ({
    title: n.title,
    content: n.summary || n.content || '',
    url: n.sourceUrl || '',
    source: n.source || 'news',
    datetime: n.publishTime || '',
    channels: n.tags?.join(',') ?? '',
  }));

  const items = mapped.slice(0, 200);

  return {
    items,
    sourceStats: aggregated.sourceStats,
    totalFetched: aggregated.totalFetched,
    dedupedCount: aggregated.dedupedCount,
  };
};

export const GET = async () => {
  try {
    // 先读缓存，根据 7/13/19 点时间档判断是否需要刷新
    const cache = readCache();
    const now = new Date();
    const desiredSlot = getNewsSlotLabel(now);
    const recomputeStart = Date.now();

    if (cache) {
      const cacheSlot = cache.slot || getNewsSlotLabel(new Date(cache.updatedAt));
      const cacheLooksLikeDemo = cache.items.some(
        (item) =>
          /^示例[:：]/.test(String(item.title || '').trim()) ||
          String(item.source || '').toLowerCase() === 'demo',
      );
      const maybeInflatedByLegacyBackfill =
        typeof cache.totalFetched === 'number' &&
        cache.items.length > Math.max(40, cache.totalFetched * 2);
      if (
        cacheSlot === desiredSlot &&
        cache.items.length > 0 &&
        !cacheLooksLikeDemo &&
        !maybeInflatedByLegacyBackfill
      ) {
        recordCacheObservation({
          module: 'news_finance',
          slot: cacheSlot,
          cached: true,
          sampleSize: cache.items.length,
        });
        return Response.json(
          {
            ok: true,
            source: 'cache',
            cached: true,
            slot: cacheSlot,
            updatedAt: cache.updatedAt,
            count: cache.items.length,
            total: cache.items.length,
            sourceStats: cache.sourceStats || [],
            sourceHealth: cache.sourceHealth || getNewsSourceHealth(),
            totalFetched: cache.totalFetched ?? cache.items.length,
            dedupedCount: cache.dedupedCount ?? cache.items.length,
            items: cache.items,
          },
          { status: 200 },
        );
      }
    }

    const bundle = await fetchFinanceNewsBundle();
    const sourceHealth = getNewsSourceHealth();
    const items = bundle.items;

    if (items.length) {
      writeCache(
        items,
        desiredSlot,
        bundle.sourceStats,
        sourceHealth,
        bundle.totalFetched,
        bundle.dedupedCount,
      );
      recordCacheObservation({
        module: 'news_finance',
        slot: desiredSlot,
        cached: false,
        sampleSize: items.length,
        recomputeMs: Date.now() - recomputeStart,
      });
      return Response.json(
        {
          ok: true,
          source: 'open-sources',
          cached: false,
          slot: desiredSlot,
          updatedAt: new Date().toISOString(),
          count: items.length,
          total: items.length,
          sourceStats: bundle.sourceStats,
          sourceHealth,
          totalFetched: bundle.totalFetched,
          dedupedCount: bundle.dedupedCount,
          items,
        },
        { status: 200 },
      );
    }

    // 主源失败时，尝试稳定 RSS 真实源回退，避免展示示例假数据
    const rssFallback = await fetchRssFallbackFinanceNews();
    if (rssFallback.length) {
      writeCache(
        rssFallback,
        desiredSlot,
        bundle.sourceStats,
        sourceHealth,
        rssFallback.length,
        rssFallback.length,
      );
      recordCacheObservation({
        module: 'news_finance',
        slot: desiredSlot,
        cached: false,
        sampleSize: rssFallback.length,
        recomputeMs: Date.now() - recomputeStart,
      });
      return Response.json(
        {
          ok: true,
          source: 'rss-fallback',
          cached: false,
          slot: desiredSlot,
          updatedAt: new Date().toISOString(),
          count: rssFallback.length,
          total: rssFallback.length,
          sourceStats: bundle.sourceStats,
          sourceHealth,
          totalFetched: rssFallback.length,
          dedupedCount: rssFallback.length,
          items: rssFallback,
        },
        { status: 200 },
      );
    }

    // 仍无数据则优先返回过期缓存，避免示例数据污染
    const hasStaleRealCache =
      cache?.items?.length &&
      !cache.items.some(
        (item) =>
          /^示例[:：]/.test(String(item.title || '').trim()) ||
          String(item.source || '').toLowerCase() === 'demo',
      );
    if (hasStaleRealCache) {
      return Response.json(
        {
          ok: true,
          source: 'cache-stale',
          cached: true,
          stale: true,
          slot: cache.slot || desiredSlot,
          updatedAt: cache.updatedAt,
          count: cache.items.length,
          total: cache.items.length,
          sourceStats: cache.sourceStats || bundle.sourceStats || [],
          sourceHealth: cache.sourceHealth || sourceHealth,
          totalFetched: cache.totalFetched ?? cache.items.length,
          dedupedCount: cache.dedupedCount ?? cache.items.length,
          items: cache.items,
        },
        { status: 200 },
      );
    }

    recordCacheObservation({
      module: 'news_finance',
      slot: desiredSlot,
      cached: false,
      sampleSize: 0,
      recomputeMs: Date.now() - recomputeStart,
    });
    return Response.json(
      {
        ok: false,
        source: 'empty',
        cached: false,
        slot: desiredSlot,
        updatedAt: new Date().toISOString(),
        count: 0,
        total: 0,
        sourceStats: [],
        sourceHealth: getNewsSourceHealth(),
        totalFetched: 0,
        dedupedCount: 0,
        items: [],
        message: 'No real finance news is currently available.',
      },
      { status: 503 },
    );
  } catch (err) {
    console.error('Error in /api/news/finance route:', err);
    const slot = getNewsSlotLabel(new Date());
    const staleCache = readCache();
    const staleRealCache =
      staleCache?.items?.length &&
      !staleCache.items.some(
        (item) =>
          /^示例[:：]/.test(String(item.title || '').trim()) ||
          String(item.source || '').toLowerCase() === 'demo',
      );
    if (staleRealCache) {
      return Response.json(
        {
          ok: true,
          source: 'cache-stale',
          cached: true,
          stale: true,
          slot: staleCache.slot || slot,
          updatedAt: staleCache.updatedAt,
          count: staleCache.items.length,
          total: staleCache.items.length,
          sourceStats: staleCache.sourceStats || [],
          sourceHealth: staleCache.sourceHealth || getNewsSourceHealth(),
          totalFetched: staleCache.totalFetched ?? staleCache.items.length,
          dedupedCount: staleCache.dedupedCount ?? staleCache.items.length,
          items: staleCache.items,
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 200 },
      );
    }
    recordCacheObservation({
      module: 'news_finance',
      slot,
      cached: false,
      sampleSize: 0,
    });
    return Response.json(
      {
        ok: false,
        source: 'error',
        cached: false,
        slot,
        updatedAt: new Date().toISOString(),
        count: 0,
        total: 0,
        sourceStats: [],
        sourceHealth: getNewsSourceHealth(),
        totalFetched: 0,
        dedupedCount: 0,
        items: [],
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
