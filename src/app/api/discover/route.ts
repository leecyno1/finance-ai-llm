import { searchSearxng } from '@/lib/searxng';
import { getSearxngURL } from '@/lib/config/serverRegistry';

const websitesForTopic = {
  tech: {
    query: ['technology news', 'latest tech', 'AI', 'science and innovation'],
    links: ['techcrunch.com', 'wired.com', 'theverge.com'],
  },
  finance: {
    query: [
      '财经 新闻',
      '宏观经济',
      '股市',
      'A股',
      '港股',
      '美股',
      '经济数据',
    ],
    links: [
      'wallstreetcn.com', // 华尔街见闻
      'cls.cn', // 财联社
      'finance.sina.com.cn', // 新浪财经
      'business.sohu.com', // 搜狐财经
      'people.com.cn', // 人民网
    ],
  },
  art: {
    query: ['art news', 'culture', 'modern art', 'cultural events'],
    links: ['artnews.com', 'hyperallergic.com', 'theartnewspaper.com'],
  },
  sports: {
    query: ['sports news', 'latest sports', 'cricket football tennis'],
    links: ['espn.com', 'bbc.com/sport', 'skysports.com'],
  },
  entertainment: {
    query: ['entertainment news', 'movies', 'TV shows', 'celebrities'],
    links: ['hollywoodreporter.com', 'variety.com', 'deadline.com'],
  },
};

type Topic = keyof typeof websitesForTopic;

const DEMO_FINANCE_BLOGS = [
  {
    title: '示例：A股收盘涨跌不一，权重股与成长股分化',
    url: 'https://finance.sina.com.cn',
    content:
      '示例数据：用于展示财经快讯效果，实际数据需在设置中配置 SearXNG 搜索源后获取实时新闻。',
    thumbnail: '',
  },
  {
    title: '示例：美股三大指数震荡，科技股波动加剧',
    url: 'https://www.wsj.com',
    content:
      '示例数据：宏观政策与利率预期变化，对全球股市造成一定扰动。',
    thumbnail: '',
  },
  {
    title: '示例：恒生指数全天走强，南向资金净流入',
    url: 'https://www.wallstreetcn.com',
    content:
      '示例数据：港股科技与医药板块表现活跃，成交放量明显回升。',
    thumbnail: '',
  },
];

type FinanceBlog = {
  title: string;
  url: string;
  content: string;
  thumbnail?: string;
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

const parseSinaRss = (xml: string): FinanceBlog[] => {
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
    const url = decodeHtmlEntities(extractTag(itemXml, 'link')).trim();
    const description = normalizeText(extractTag(itemXml, 'description'));

    if (!title || !url) continue;

    items.push({
      title,
      url,
      content: description,
      thumbnail: '',
    });
  }

  return items;
};

const parseGenericRss = (xml: string): FinanceBlog[] => {
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
      `<${tag}[^>]*?\\s${attr}=\"([^\"]+)\"[^>]*?>`,
      'i',
    );
    const match = itemXml.match(regex);
    return match?.[1] ?? '';
  };

  for (const itemXml of matches) {
    const titleRaw = extractTagRaw(itemXml, 'title');
    const linkRaw = extractTagRaw(itemXml, 'link');
    const descriptionRaw =
      extractTagRaw(itemXml, 'description') || extractTagRaw(itemXml, 'summary');

    const title = normalizeText(titleRaw);
    let url = decodeHtmlEntities(linkRaw).trim();
    const descriptionDecoded = decodeHtmlEntities(stripCdata(descriptionRaw));
    const description = stripTags(descriptionDecoded);

    // some RSS uses <guid isPermaLink="true"> as link
    if (!url) {
      const guid = decodeHtmlEntities(extractTagRaw(itemXml, 'guid')).trim();
      if (guid.startsWith('http')) url = guid;
    }

    const enclosure = extractAttr(itemXml, 'enclosure', 'url');
    const mediaContent = extractAttr(itemXml, 'media:content', 'url');
    const mediaThumb = extractAttr(itemXml, 'media:thumbnail', 'url');

    let thumbnail = mediaThumb || mediaContent || enclosure || '';
    if (!thumbnail && descriptionDecoded) {
      // Google News and some feeds embed images in the description HTML (sometimes entity-escaped).
      const match = descriptionDecoded.match(
        /<img[^>]*\ssrc=["']([^"']+)["']/i,
      );
      if (match?.[1]) thumbnail = match[1];
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
    'http://rss.sina.com.cn/roll/finance/hot_roll.xml', // 财经要闻汇总
    'http://rss.sina.com.cn/news/allnews/finance.xml', // 财经焦点新闻
    'http://rss.sina.com.cn/roll/stock/hot_roll.xml', // 股票要闻
  ];

  const results = await Promise.allSettled(
    rssFeeds.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`RSS HTTP error: ${res.status}`);
      }
      const xml = await res.text();
      return parseSinaRss(xml);
    }),
  );

  const blogs = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap(
      (r) =>
        (r as PromiseFulfilledResult<ReturnType<typeof parseSinaRss>>).value,
    );

  const seen = new Set<string>();
  return blogs.filter((b) => {
    const key = b.url.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const RSS_BY_TOPIC: Record<Topic, string[]> = {
  tech: [
    'https://news.google.com/rss/search?q=technology%20OR%20AI%20OR%20science&hl=en-US&gl=US&ceid=US:en',
    'https://www.theverge.com/rss/index.xml',
    'https://feeds.feedburner.com/TechCrunch/',
  ],
  finance: [
    'https://news.google.com/rss/search?q=finance%20OR%20stock%20OR%20macro%20OR%20interest%20rate&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=%E8%B4%A2%E7%BB%8F%20OR%20%E8%82%A1%E5%B8%82%20OR%20%E5%AE%8F%E8%A7%82%20OR%20%E5%88%A9%E7%8E%87&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  ],
  art: [
    'https://news.google.com/rss/search?q=art%20OR%20culture%20OR%20museum&hl=en-US&gl=US&ceid=US:en',
  ],
  sports: [
    'https://news.google.com/rss/search?q=sports%20OR%20football%20OR%20basketball&hl=en-US&gl=US&ceid=US:en',
  ],
  entertainment: [
    'https://news.google.com/rss/search?q=entertainment%20OR%20movies%20OR%20tv&hl=en-US&gl=US&ceid=US:en',
  ],
};

const fetchBlogsFromRss = async (urls: string[]): Promise<FinanceBlog[]> => {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`RSS HTTP error: ${res.status}`);
      }
      const xml = await res.text();
      return parseGenericRss(xml);
    }),
  );

  const blogs = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap(
      (r) =>
        (r as PromiseFulfilledResult<ReturnType<typeof parseGenericRss>>).value,
    );

  const seen = new Set<string>();
  return blogs.filter((b) => {
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
    const params = new URL(req.url).searchParams;

    const mode: 'normal' | 'preview' =
      (params.get('mode') as 'normal' | 'preview') || 'normal';
    const topic: Topic = (params.get('topic') as Topic) || 'tech';

    const selectedTopic = websitesForTopic[topic];
    const language = topic === 'finance' ? 'zh-CN' : 'en';

    // 财经：优先尝试从新浪 RSS 获取真实新闻
    if (topic === 'finance') {
      const rssBlogs = await fetchFinanceNewsFromRss();
      if (rssBlogs.length) {
        return Response.json(
          {
            blogs: rssBlogs,
          },
          { status: 200 },
        );
      }
      // RSS 失败时至少返回示例数据，保证前端有内容
      return Response.json(
        {
          blogs: DEMO_FINANCE_BLOGS,
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
          blogs: rssBlogs.map(toDiscoverItem),
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
          blogs: rssBlogs.map(toDiscoverItem),
        },
        { status: 200 },
      );
    }

    return Response.json(
      {
        blogs: (data as any[]).map(toDiscoverItem),
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
