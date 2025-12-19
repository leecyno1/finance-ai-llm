import { searchSearxng } from '@/lib/searxng';
import { getSearxngURL } from '@/lib/config/serverRegistry';

export const runtime = 'nodejs';

const websitesForTopic = {
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

type Topic = keyof typeof websitesForTopic;

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

const withOgFallbackThumbnail = (blog: FinanceBlog): FinanceBlog => {
  const hasThumbnail = (blog.thumbnail || '').trim().length > 0;
  const url = (blog.url || '').trim();
  if (hasThumbnail || !url.startsWith('http')) return blog;
  return { ...blog, thumbnail: `/api/og-image?url=${encodeURIComponent(url)}` };
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

const fetchFinanceNewsFromRss = async (): Promise<FinanceBlog[]> => {
  const rssFeeds = [
    'https://www.cnbc.com/id/100003114/device/rss/rss.html', // CNBC Top News
    'https://www.cnbc.com/id/15839069/device/rss/rss.html', // CNBC Markets
    'https://www.marketwatch.com/rss/topstories', // MarketWatch
    'https://feeds.content.dowjones.io/public/rss/mw_topstories', // MarketWatch (DJ)
    'https://finance.yahoo.com/rss/topstories', // Yahoo Finance
    'https://www.nasdaq.com/feed/rssoutbound?category=markets', // Nasdaq Markets
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

  const seen = new Set<string>();
  return blogs
    .filter((b) => {
      const key = b.url.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(withOgFallbackThumbnail);
};

const RSS_BY_TOPIC: Record<Topic, string[]> = {
  tech: [
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    'https://www.wired.com/feed/rss',
  ],
  finance: [],
  art: [
    'https://www.artnews.com/c/art-news/news/feed/',
    'https://hyperallergic.com/feed/',
    'https://www.artforum.com/feed/',
    'https://www.artsy.net/rss/news',
  ],
  sports: [
    'https://www.espn.com/espn/rss/news',
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
    })
    .map(withOgFallbackThumbnail);
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
    const params = new URL(req.url).searchParams;

    const mode: 'normal' | 'preview' =
      (params.get('mode') as 'normal' | 'preview') || 'normal';
    const topic: Topic = (params.get('topic') as Topic) || 'tech';

    const selectedTopic = websitesForTopic[topic];
    const language = topic === 'finance' ? 'zh-CN' : 'en';

    // 财经：优先使用华尔街见闻文章源（带封面图），失败再回退到 RSS / 示例
    if (topic === 'finance') {
      const rssBlogs = await fetchFinanceNewsFromRss();
      const merged = [...rssBlogs];
      const seen = new Set<string>();
      const deduped = merged.filter((b) => {
        const key = b.url.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (deduped.length) {
        return Response.json(
          {
            blogs: deduped.slice(0, 60),
          },
          { status: 200 },
        );
      }
      // RSS 失败时至少返回示例数据，保证前端有内容
      return Response.json(
        {
          blogs: DEMO_FINANCE_BLOGS.map(withOgFallbackThumbnail),
        },
        { status: 200 },
      );
    }

    // 其它主题：优先使用固定 RSS 源（更稳定且更容易带图），失败再退回 SearXNG
    const rssFirstBlogs = await fetchBlogsFromRss(RSS_BY_TOPIC[topic] ?? []);
    if (rssFirstBlogs.length) {
      return Response.json(
        {
          blogs: rssFirstBlogs.map(toDiscoverItem).map(withOgFallbackThumbnail),
        },
        { status: 200 },
      );
    }

    const searxngURL = getSearxngURL();
    let data = [];

    if (!searxngURL) {
      // 其它主题在未配置 SearXNG 时，回退到公开 RSS（保证 Discover 有内容）
      const rssBlogs = await fetchBlogsFromRss(RSS_BY_TOPIC[topic] ?? []);
      return Response.json(
        {
          blogs: rssBlogs.map(toDiscoverItem).map(withOgFallbackThumbnail),
        },
        { status: 200 },
      );
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
                    language,
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
              language,
            },
          )
        ).results;
      }
    } catch (err) {
      console.error('Discover searxng failed, fallback to rss', err);
      const rssBlogs = await fetchBlogsFromRss(RSS_BY_TOPIC[topic] ?? []);
      return Response.json(
        {
          blogs: rssBlogs.map(toDiscoverItem).map(withOgFallbackThumbnail),
        },
        { status: 200 },
      );
    }

    return Response.json(
      {
        blogs: (data as any[]).map(toDiscoverItem).map(withOgFallbackThumbnail),
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error(`An error occurred in discover route: ${err}`);
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
