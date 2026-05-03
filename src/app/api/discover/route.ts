import fs from 'fs';
import path from 'node:path';
import { searchSearxng } from '@/lib/searxng';
import { getSearxngURL } from '@/lib/config/serverRegistry';
import { recordCacheObservation } from '@/lib/cache/observability';

export const runtime = 'nodejs';

const websitesForTopicEn = {
  tech: {
    query: ['technology news', 'latest tech', 'AI', 'science and innovation'],
    links: ['techcrunch.com', 'wired.com', 'theverge.com'],
  },
  finance: {
    query: [
      'US markets news',
      'Federal Reserve',
      'inflation data',
      'earnings',
      'stocks',
      'bonds',
      'macro data',
    ],
    links: [
      // Discover Finance: prefer US sources (RSS-first); keep these for SearXNG fallback.
      'cnbc.com',
      'marketwatch.com',
      'finance.yahoo.com',
      'nasdaq.com',
    ],
  },
  art: {
    query: ['art news', 'culture', 'modern art', 'cultural events'],
    links: ['artnews.com', 'hyperallergic.com', 'artforum.com', 'artsy.net'],
  },
  sports: {
    query: ['sports news', 'latest sports', 'cricket football tennis'],
    links: ['espn.com', 'skysports.com', 'cbssports.com'],
  },
  entertainment: {
    query: ['entertainment news', 'movies', 'TV shows', 'celebrities'],
    links: ['variety.com', 'hollywoodreporter.com', 'tmz.com', 'rollingstone.com'],
  },
};

const websitesForTopicZh: Record<keyof typeof websitesForTopicEn, {
  query: string[];
  links: string[];
}> = {
  tech: {
    query: ['科技 新闻', '人工智能', '半导体', '互联网 公司'],
    links: ['ithome.com', '36kr.com', 'huxiu.com', 'sina.com.cn'],
  },
  finance: {
    query: ['财经 新闻', '宏观 经济', 'A股 港股 美股', '货币政策 利率 债券'],
    links: [
      'wallstreetcn.com',
      'finance.sina.com.cn',
      'finance.eastmoney.com',
      'stcn.com',
    ],
  },
  art: {
    query: ['艺术 文化 新闻', '展览 艺术 市场', '文博 艺术 机构'],
    links: ['art.ifeng.com', 'culture.people.com.cn', 'chinanews.com.cn'],
  },
  sports: {
    query: ['体育 新闻', '足球 篮球 网球', '赛事 快讯'],
    links: ['sports.sina.com.cn', 'sports.163.com', 'sports.qq.com'],
  },
  entertainment: {
    query: ['娱乐 新闻', '电影 综艺 明星', '影视 行业'],
    links: ['ent.163.com', 'ent.sina.com.cn', 'ent.qq.com'],
  },
};

type Topic = keyof typeof websitesForTopicEn;
type DiscoverMode = 'normal' | 'preview';

const DEMO_FINANCE_BLOGS = [
  {
    title: 'Demo: Markets digest — key moves across stocks, rates, and macro',
    url: 'https://www.cnbc.com',
    content:
      'Demo data: shown only when finance feeds are temporarily unavailable.',
    thumbnail: '',
  },
  {
    title: 'Demo: Fed / inflation updates — what matters next for risk assets',
    url: 'https://www.marketwatch.com',
    content:
      'Demo data: shown only when finance feeds are temporarily unavailable.',
    thumbnail: '',
  },
  {
    title: 'Demo: Earnings and sector rotation — quick scan + follow-ups',
    url: 'https://finance.yahoo.com',
    content: 'Demo data: shown only when finance feeds are temporarily unavailable.',
    thumbnail: '',
  },
];

type FinanceBlog = {
  title: string;
  url: string;
  content: string;
  thumbnail?: string;
};

type DiscoverCacheEntry = {
  slot: string;
  updatedAt: number;
  blogs: FinanceBlog[];
};

type DiscoverCachePayload = {
  version: number;
  entries: Record<string, DiscoverCacheEntry>;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const DISCOVER_CACHE_PATH = path.join(DATA_DIR, 'data/discover-cache.json');
const DISCOVER_CACHE_VERSION = 1;

const pad = (n: number) => String(n).padStart(2, '0');

const getSixHourSlotLabel = (d: Date) => {
  const local = new Date(d.getTime());
  const slotHour = local.getHours() - (local.getHours() % 6);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(slotHour)}`;
};

const buildDiscoverCacheKey = (
  topic: Topic,
  lang: 'zh' | 'en',
  mode: DiscoverMode,
) => `${lang}:${topic}:${mode}`;

const loadDiscoverCache = (): DiscoverCachePayload => {
  try {
    if (!fs.existsSync(DISCOVER_CACHE_PATH)) {
      return { version: DISCOVER_CACHE_VERSION, entries: {} };
    }

    const raw = fs.readFileSync(DISCOVER_CACHE_PATH, 'utf8');
    if (!raw.trim()) {
      return { version: DISCOVER_CACHE_VERSION, entries: {} };
    }

    const parsed = JSON.parse(raw) as DiscoverCachePayload;
    if (
      !parsed ||
      parsed.version !== DISCOVER_CACHE_VERSION ||
      !parsed.entries ||
      typeof parsed.entries !== 'object'
    ) {
      return { version: DISCOVER_CACHE_VERSION, entries: {} };
    }

    return parsed;
  } catch {
    return { version: DISCOVER_CACHE_VERSION, entries: {} };
  }
};

const saveDiscoverCacheEntry = (key: string, slot: string, blogs: FinanceBlog[]) => {
  try {
    const cache = loadDiscoverCache();
    cache.entries[key] = {
      slot,
      updatedAt: Date.now(),
      blogs,
    };

    const dir = path.dirname(DISCOVER_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DISCOVER_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write discover cache', err);
  }
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
) => {
  const timeoutMs = init.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
};

const dedupeBlogs = (items: FinanceBlog[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const raw = (item.url || '').trim().toLowerCase();
    if (!raw) return false;
    const normalized = raw.replace(/[#?].*$/, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const resolveUrl = (raw: string, baseUrl?: string) => {
  const value = (raw || '').trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('//')) return `https:${value}`;

  if (baseUrl) {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  }

  return value;
};

const stripCdata = (value: string) =>
  value.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();

const decodeHtmlEntities = (input: string) => {
  const map: Record<string, string> = {
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, entity) => {
    if (!entity) return m;
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const raw = hex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(raw, hex ? 16 : 10);
      if (!Number.isFinite(codePoint)) return m;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return m;
      }
    }
    const named = entity.toLowerCase();
    return map[named] ?? m;
  });
};

const stripTags = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const normalizeText = (value: string) => {
  if (!value) return '';
  const noCdata = stripCdata(value);
  const decoded = decodeHtmlEntities(noCdata);
  return stripTags(decoded);
};

const hasChinese = (value: string) => /[\u4e00-\u9fff]/.test(value);

const zhTranslateCache = new Map<string, string>();

const translateToZh = async (text: string): Promise<string> => {
  const input = (text || '').trim();
  if (!input || hasChinese(input)) return input;
  const key = input.slice(0, 500);
  const cached = zhTranslateCache.get(key);
  if (cached) return cached;

  try {
    const endpoint =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(
        key,
      )}`;
    const res = await fetchWithTimeout(endpoint, {
      cache: 'no-store',
      timeoutMs: 4500,
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!res.ok) return input;
    const data = (await res.json()) as any[];
    const translated = (data?.[0] as any[] | undefined)
      ?.map((chunk) => String(chunk?.[0] ?? ''))
      .join('')
      .trim();
    const output = translated || input;
    zhTranslateCache.set(key, output);
    return output;
  } catch {
    return input;
  }
};

const localizeBlogs = async (
  blogs: FinanceBlog[],
  lang: 'zh' | 'en',
): Promise<FinanceBlog[]> => {
  if (lang !== 'zh') return blogs;

  const localized = await Promise.all(
    blogs.map(async (blog) => {
      const [title, content] = await Promise.all([
        translateToZh(blog.title),
        translateToZh(blog.content),
      ]);
      return {
        ...blog,
        title,
        content,
      };
    }),
  );

  return localized;
};

const withOgFallbackThumbnail = (blog: FinanceBlog): FinanceBlog => {
  const hasThumbnail = (blog.thumbnail || '').trim().length > 0;
  const url = (blog.url || '').trim();
  if (hasThumbnail || !url.startsWith('http')) return blog;
  return { ...blog, thumbnail: `/api/og-image?url=${encodeURIComponent(url)}` };
};

const looksLikeWeakThumbnail = (thumbnail: string | undefined) => {
  const value = (thumbnail || '').trim().toLowerCase();
  if (!value) return true;
  return (
    value.includes('share.png') ||
    value.includes('toparr') ||
    value.includes('logo') ||
    value.includes('icon') ||
    value.includes('sprite')
  );
};

const prioritizeImageRich = (blogs: FinanceBlog[]) =>
  [...blogs].sort((a, b) => {
    const aStrong = looksLikeWeakThumbnail(a.thumbnail) ? 0 : 1;
    const bStrong = looksLikeWeakThumbnail(b.thumbnail) ? 0 : 1;
    if (aStrong !== bStrong) return bStrong - aStrong;
    return 0;
  });

const isStrongDirectThumbnail = (thumbnail: string | undefined) => {
  const value = (thumbnail || '').trim();
  if (!/^https?:\/\//i.test(value)) return false;
  return !looksLikeWeakThumbnail(value);
};

const MAX_ITEMS_BY_TOPIC: Record<Topic, number> = {
  tech: 60,
  finance: 48,
  art: 60,
  sports: 60,
  entertainment: 60,
};

const IMAGE_SENSITIVE_TOPICS = new Set<Topic>(['finance', 'art', 'sports']);

const finalizeDiscoverBlogs = (
  topic: Topic,
  blogs: FinanceBlog[],
): FinanceBlog[] => {
  const deduped = dedupeBlogs(blogs);
  const prioritized = prioritizeImageRich(deduped);
  const limit = MAX_ITEMS_BY_TOPIC[topic] ?? 60;

  // For image-heavy tabs, prefer entries with strong direct thumbnails first,
  // so card images don't rely on expensive OG extraction fallback.
  if (IMAGE_SENSITIVE_TOPICS.has(topic)) {
    const direct = prioritized.filter((b) => isStrongDirectThumbnail(b.thumbnail));
    const backup = prioritized.filter((b) => !isStrongDirectThumbnail(b.thumbnail));
    const minDirectOnly = 18;

    const selected =
      direct.length >= minDirectOnly
        ? direct
        : [...direct, ...backup.slice(0, Math.max(0, minDirectOnly - direct.length))];

    return selected.slice(0, limit).map(withOgFallbackThumbnail);
  }

  return prioritized.slice(0, limit).map(withOgFallbackThumbnail);
};

const isCnDomain = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith('.cn') ||
      host.includes('sina.com') ||
      host.includes('163.com') ||
      host.includes('qq.com') ||
      host.includes('people.com')
    );
  } catch {
    return false;
  }
};

const prioritizeLocalizedBlogs = (
  blogs: FinanceBlog[],
  lang: 'zh' | 'en',
): FinanceBlog[] => {
  if (lang !== 'zh') return blogs;

  const cnStrong: FinanceBlog[] = [];
  const others: FinanceBlog[] = [];

  for (const blog of blogs) {
    const text = `${blog.title || ''} ${blog.content || ''}`;
    if (hasChinese(text) || isCnDomain(blog.url || '')) cnStrong.push(blog);
    else others.push(blog);
  }

  return [...cnStrong, ...others];
};

const parseSinaRss = (xml: string, feedUrl?: string): FinanceBlog[] => {
  const items: FinanceBlog[] = [];

  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];

  const extractTag = (itemXml: string, tag: string) => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = itemXml.match(regex);
    if (!match) return '';
    return stripCdata(match[1]);
  };

  for (const itemXml of matches) {
    const title = normalizeText(extractTag(itemXml, 'title'));
    const url = resolveUrl(
      decodeHtmlEntities(extractTag(itemXml, 'link')).trim(),
      feedUrl,
    );
    const descriptionRaw = extractTag(itemXml, 'description');
    const descriptionDecoded = decodeHtmlEntities(stripCdata(descriptionRaw));
    const description = stripTags(descriptionDecoded);

    let thumbnail = '';
    if (descriptionDecoded) {
      const match = descriptionDecoded.match(
        /<img[^>]*\ssrc=["']([^"']+)["']/i,
      );
      if (match?.[1]) thumbnail = resolveUrl(match[1], url || feedUrl);
    }

    if (!title || !url) continue;

    items.push({
      title,
      url,
      content: description,
      thumbnail,
    });
  }

  return items;
};

const parseGenericRss = (xml: string, feedUrl?: string): FinanceBlog[] => {
  const items: FinanceBlog[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];

  const extractTagRaw = (itemXml: string, tag: string) => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = itemXml.match(regex);
    if (!match) return '';
    return stripCdata(match[1]);
  };

  const extractAttr = (itemXml: string, tag: string, attr: string) => {
    const regex = new RegExp(
      `<${tag}[^>]*?\\s${attr}=(\"([^\"]+)\"|'([^']+)')[^>]*?>`,
      'i',
    );
    const match = itemXml.match(regex);
    return match?.[2] ?? match?.[3] ?? '';
  };

  for (const itemXml of matches) {
    const titleRaw = extractTagRaw(itemXml, 'title');
    const linkRaw = extractTagRaw(itemXml, 'link');
    const descriptionRaw =
      extractTagRaw(itemXml, 'description') ||
      extractTagRaw(itemXml, 'summary') ||
      extractTagRaw(itemXml, 'content:encoded');

    const title = normalizeText(titleRaw);
    let url = resolveUrl(decodeHtmlEntities(linkRaw).trim(), feedUrl);
    const descriptionDecoded = decodeHtmlEntities(stripCdata(descriptionRaw));
    const description = stripTags(descriptionDecoded);

    // some RSS uses <guid isPermaLink="true"> as link
    if (!url) {
      const guid = resolveUrl(
        decodeHtmlEntities(extractTagRaw(itemXml, 'guid')).trim(),
        feedUrl,
      );
      if (guid.startsWith('http')) url = guid;
    }

    const enclosure = extractAttr(itemXml, 'enclosure', 'url');
    const mediaContent = extractAttr(itemXml, 'media:content', 'url');
    const mediaThumb = extractAttr(itemXml, 'media:thumbnail', 'url');

    let thumbnail =
      decodeHtmlEntities(mediaThumb || mediaContent || enclosure || '').trim();
    thumbnail = resolveUrl(thumbnail, url || feedUrl);
    if (!thumbnail && descriptionDecoded) {
      // Google News and some feeds embed images in the description HTML (sometimes entity-escaped).
      const match = descriptionDecoded.match(
        /<img[^>]*\ssrc=["']([^"']+)["']/i,
      );
      if (match?.[1]) thumbnail = resolveUrl(match[1], url || feedUrl);
    }

    if (!title || !url) continue;

    items.push({
      title,
      url,
      content: description,
      thumbnail,
    });
  }

  return items;
};

const fetchEnglishFinanceNewsFromRss = async (): Promise<FinanceBlog[]> => {
  const rssFeeds = [
    'https://www.marketwatch.com/rss/topstories', // MarketWatch
    'https://feeds.content.dowjones.io/public/rss/mw_topstories', // MarketWatch (DJ)
  ];

  const results = await Promise.allSettled(
    rssFeeds.map(async (url) => {
      const res = await fetchWithTimeout(url, { timeoutMs: 10_000 });
      if (!res.ok) {
        throw new Error(`RSS HTTP error: ${res.status}`);
      }
      const xml = await res.text();
      return parseGenericRss(xml, url);
    }),
  );

  const blogs = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => (r as PromiseFulfilledResult<FinanceBlog[]>).value);

  return dedupeBlogs(blogs);
};

const fetchWallstreetcnFinanceNews = async (): Promise<FinanceBlog[]> => {
  const endpoint = 'https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global';
  const res = await fetchWithTimeout(endpoint, {
    timeoutMs: 10_000,
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Wallstreetcn API error: ${res.status}`);
  }

  const payload = (await res.json()) as any;
  const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];

  const blogs: FinanceBlog[] = items
    .map((item: any) => {
      const title = normalizeText(String(item?.title ?? ''));
      const url = resolveUrl(
        String(item?.uri ?? item?.article?.uri ?? '').trim(),
      );
      const content = normalizeText(
        String(item?.content_text ?? item?.content ?? item?.reference ?? ''),
      );
      const thumbnail = resolveUrl(
        String(
          item?.article?.image?.uri ??
            item?.images?.[0]?.uri ??
            item?.cover_images?.[0]?.uri ??
            '',
        ),
        url,
      );

      return {
        title,
        url,
        content: content || title,
        thumbnail,
      };
    })
    .filter((item: FinanceBlog) => item.title && item.url);

  return dedupeBlogs(blogs);
};

const fetchSinaFinanceNews = async (): Promise<FinanceBlog[]> => {
  const endpoint =
    'https://feed.sina.com.cn/api/roll/get?pageid=155&lid=1686&num=80&page=1';
  const res = await fetchWithTimeout(endpoint, {
    timeoutMs: 10_000,
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Sina API error: ${res.status}`);
  }

  const payload = (await res.json()) as any;
  const items = Array.isArray(payload?.result?.data) ? payload.result.data : [];

  const blogs: FinanceBlog[] = items
    .map((item: any) => {
      const title = normalizeText(String(item?.title ?? ''));
      const url = resolveUrl(String(item?.url ?? '').trim());
      const content = normalizeText(
        String(
          item?.summary ?? item?.intro ?? item?.wapsummary ?? item?.stitle ?? '',
        ),
      );
      const thumbnail = resolveUrl(
        String(item?.images?.[0]?.u ?? item?.img?.u ?? ''),
        url,
      );

      return {
        title,
        url,
        content: content || title,
        thumbnail,
      };
    })
    .filter((item: FinanceBlog) => item.title && item.url);

  return dedupeBlogs(blogs);
};

const fetchChineseFinanceNews = async (): Promise<FinanceBlog[]> => {
  const rssFeeds = [
    'https://www.chinanews.com.cn/rss/finance.xml',
    'https://www.people.com.cn/rss/finance.xml',
  ];

  const [sinaResult, rssResult, enRssResult, wscnResult] =
    await Promise.allSettled([
    fetchSinaFinanceNews(),
    fetchBlogsFromRss(rssFeeds),
    fetchEnglishFinanceNewsFromRss(),
    fetchWallstreetcnFinanceNews(),
  ]);

  const merged: FinanceBlog[] = [];
  if (sinaResult.status === 'fulfilled') merged.push(...sinaResult.value);
  if (rssResult.status === 'fulfilled') merged.push(...rssResult.value);
  if (enRssResult.status === 'fulfilled') merged.push(...enRssResult.value);
  if (wscnResult.status === 'fulfilled') merged.push(...wscnResult.value);

  return prioritizeImageRich(dedupeBlogs(merged));
};

const RSS_BY_TOPIC_EN: Record<Topic, string[]> = {
  tech: [
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    'https://www.wired.com/feed/rss',
  ],
  finance: [],
  art: [
    'https://hyperallergic.com/feed/',
    'https://www.artsy.net/rss/news',
    'https://www.smithsonianmag.com/rss/arts-culture/',
  ],
  sports: [
    'https://www.skysports.com/rss/12040',
    'https://www.cbssports.com/rss/headlines/',
  ],
  entertainment: [
    'https://variety.com/feed/',
    'https://www.hollywoodreporter.com/feed/',
    'https://www.tmz.com/rss.xml',
    'https://www.rollingstone.com/feed/',
  ],
};

const RSS_BY_TOPIC_ZH: Record<Topic, string[]> = {
  tech: [
    'https://www.ithome.com/rss/',
    'https://www.36kr.com/feed',
    'https://www.ifanr.com/feed',
    'https://www.people.com.cn/rss/it.xml',
  ],
  finance: [
    'https://www.chinanews.com.cn/rss/finance.xml',
    'https://www.people.com.cn/rss/finance.xml',
    'https://www.cnbc.com/id/15839069/device/rss/rss.html',
    'https://www.marketwatch.com/rss/topstories',
  ],
  art: [
    'https://www.people.com.cn/rss/culture.xml',
    'https://www.chinanews.com.cn/rss/culture.xml',
    'https://www.chinanews.com.cn/rss/cul.shtml',
  ],
  sports: [
    'https://www.people.com.cn/rss/sports.xml',
    'https://www.chinanews.com.cn/rss/sports.xml',
    'https://www.chinanews.com.cn/rss/ty.shtml',
  ],
  entertainment: ['https://www.people.com.cn/rss/ent.xml'],
};

const getRssFeedsByLanguage = (topic: Topic, lang: 'zh' | 'en') => {
  const primary = lang === 'zh' ? RSS_BY_TOPIC_ZH : RSS_BY_TOPIC_EN;
  return primary[topic] ?? [];
};

const fetchBlogsFromRss = async (urls: string[]): Promise<FinanceBlog[]> => {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetchWithTimeout(url, {
        cache: 'no-store',
        timeoutMs: 10_000,
      });
      if (!res.ok) {
        throw new Error(`RSS HTTP error: ${res.status}`);
      }
      const xml = await res.text();
      return parseGenericRss(xml, url);
    }),
  );

  const blogs = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap(
      (r) =>
        (r as PromiseFulfilledResult<ReturnType<typeof parseGenericRss>>).value,
    );

  const seen = new Set<string>();
  return blogs
    .filter((b) => {
      const key = b.url.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const toDiscoverItem = (item: any): FinanceBlog => ({
  title: normalizeText(String(item.title ?? '')),
  url: String(item.url ?? ''),
  content: normalizeText(String(item.content ?? '')),
  thumbnail:
    String(
      item.thumbnail ??
        item.thumbnail_src ??
        item.img_src ??
        item.image ??
        '',
    ) || '',
});

export const GET = async (req: Request) => {
  try {
    const requestStart = Date.now();
    const params = new URL(req.url).searchParams;

    const mode: DiscoverMode =
      (params.get('mode') as DiscoverMode) || 'normal';
    const topicRaw = (params.get('topic') as Topic) || 'tech';
    const topic: Topic = topicRaw in websitesForTopicEn ? topicRaw : 'tech';
    const lang = params.get('lang') === 'en' ? 'en' : 'zh';
    const slotLabel = getSixHourSlotLabel(new Date());
    const cacheKey = buildDiscoverCacheKey(topic, lang, mode);
    const cachePayload = loadDiscoverCache();
    const cachedEntry = cachePayload.entries[cacheKey];
    if (
      cachedEntry &&
      cachedEntry.slot === slotLabel &&
      Array.isArray(cachedEntry.blogs) &&
      cachedEntry.blogs.length > 0
    ) {
      recordCacheObservation({
        module: 'discover',
        slot: cachedEntry.slot,
        cached: true,
        sampleSize: cachedEntry.blogs.length,
      });
      return Response.json(
        {
          blogs: cachedEntry.blogs,
          cached: true,
          updatedAt: cachedEntry.updatedAt,
          slot: cachedEntry.slot,
        },
        { status: 200 },
      );
    }

    const respondBlogs = (blogs: FinanceBlog[]) => {
      saveDiscoverCacheEntry(cacheKey, slotLabel, blogs);
      recordCacheObservation({
        module: 'discover',
        slot: slotLabel,
        cached: false,
        sampleSize: blogs.length,
        recomputeMs: Date.now() - requestStart,
      });
      return Response.json(
        {
          blogs,
          cached: false,
          updatedAt: Date.now(),
          slot: slotLabel,
        },
        { status: 200 },
      );
    };

    const selectedTopic =
      lang === 'zh' ? websitesForTopicZh[topic] : websitesForTopicEn[topic];
    const searchLanguage = lang === 'zh' ? 'zh-CN' : 'en';

    // 财经：按语言优先真实源，失败再回退示例
    if (topic === 'finance') {
      const deduped =
        lang === 'zh'
          ? await fetchChineseFinanceNews()
          : await fetchEnglishFinanceNewsFromRss();

      if (deduped.length) {
        const localized = await localizeBlogs(finalizeDiscoverBlogs(topic, deduped), lang);
        return respondBlogs(localized);
      }
      const localizedDemo = await localizeBlogs(
        finalizeDiscoverBlogs(topic, DEMO_FINANCE_BLOGS),
        lang,
      );
      return respondBlogs(localizedDemo);
    }

    // 其它主题：优先使用语言对应 RSS 源（更稳定且更容易带图），失败再退回 SearXNG
    const rssFirstBlogs = await fetchBlogsFromRss(
      getRssFeedsByLanguage(topic, lang),
    );
    if (rssFirstBlogs.length) {
      const localized = await localizeBlogs(
        finalizeDiscoverBlogs(
          topic,
          prioritizeLocalizedBlogs(rssFirstBlogs.map(toDiscoverItem), lang),
        ),
        lang,
      );
      return respondBlogs(localized);
    }

    const searxngURL = getSearxngURL();
    let data = [];

    if (!searxngURL) {
      // 其它主题在未配置 SearXNG 时，回退到公开 RSS（保证 Discover 有内容）
      const rssBlogs = await fetchBlogsFromRss(getRssFeedsByLanguage(topic, lang));
      const localized = await localizeBlogs(
        finalizeDiscoverBlogs(
          topic,
          prioritizeLocalizedBlogs(rssBlogs.map(toDiscoverItem), lang),
        ),
        lang,
      );
      return respondBlogs(localized);
    }

    try {
      if (mode === 'normal') {
        const seenUrls = new Set();

        data = (
          await Promise.all(
            selectedTopic.links.flatMap((link) =>
              selectedTopic.query.map(async (query) => {
                return (
                  await searchSearxng(`site:${link} ${query}`, {
                    engines: ['bing news'],
                    pageno: 1,
                    language: searchLanguage,
                  })
                ).results;
              }),
            ),
          )
        )
          .flat()
          .filter((item) => {
            const url = item.url?.toLowerCase().trim();
            if (seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
          })
          .sort(() => Math.random() - 0.5);
      } else {
        data = (
          await searchSearxng(
            `site:${selectedTopic.links[Math.floor(Math.random() * selectedTopic.links.length)]} ${selectedTopic.query[Math.floor(Math.random() * selectedTopic.query.length)]}`,
            {
              engines: ['bing news'],
              pageno: 1,
              language: searchLanguage,
            },
          )
        ).results;
      }
    } catch (err) {
      console.error('Discover searxng failed, fallback to rss', err);
      const rssBlogs = await fetchBlogsFromRss(getRssFeedsByLanguage(topic, lang));
      const localized = await localizeBlogs(
        finalizeDiscoverBlogs(
          topic,
          prioritizeLocalizedBlogs(rssBlogs.map(toDiscoverItem), lang),
        ),
        lang,
      );
      return respondBlogs(localized);
    }

    const localized = await localizeBlogs(
      finalizeDiscoverBlogs(
        topic,
        prioritizeLocalizedBlogs((data as any[]).map(toDiscoverItem), lang),
      ),
      lang,
    );
    return respondBlogs(localized);
  } catch (err) {
    console.error(`An error occurred in discover route: ${err}`);
    try {
      const params = new URL(req.url).searchParams;
      const mode: DiscoverMode =
        (params.get('mode') as DiscoverMode) || 'normal';
      const topicRaw = (params.get('topic') as Topic) || 'tech';
      const topic: Topic = topicRaw in websitesForTopicEn ? topicRaw : 'tech';
      const lang = params.get('lang') === 'en' ? 'en' : 'zh';
      const cacheKey = buildDiscoverCacheKey(topic, lang, mode);
      const stale = loadDiscoverCache().entries[cacheKey];
      if (stale?.blogs?.length) {
        recordCacheObservation({
          module: 'discover',
          slot: stale.slot || getSixHourSlotLabel(new Date()),
          cached: true,
          sampleSize: stale.blogs.length,
        });
        return Response.json(
          {
            blogs: stale.blogs,
            cached: true,
            stale: true,
            updatedAt: stale.updatedAt,
            slot: stale.slot,
          },
          { status: 200 },
        );
      }
    } catch {
      // ignore stale fallback error
    }
    recordCacheObservation({
      module: 'discover',
      slot: getSixHourSlotLabel(new Date()),
      cached: false,
      sampleSize: 0,
    });
    return Response.json(
      {
        blogs: [],
        message: 'An error has occurred',
      },
      {
        status: 500,
      },
    );
  }
};
