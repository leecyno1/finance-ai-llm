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

const parseSinaRss = (xml: string): FinanceBlog[] => {
  const items: FinanceBlog[] = [];

  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];

  const stripCdata = (value: string) =>
    value.replace('<![CDATA[', '').replace(']]>', '').trim();

  const extractTag = (itemXml: string, tag: string) => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = itemXml.match(regex);
    if (!match) return '';
    return stripCdata(match[1]);
  };

  for (const itemXml of matches) {
    const title = extractTag(itemXml, 'title');
    const url = extractTag(itemXml, 'link');
    const description = extractTag(itemXml, 'description');

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
      // 其它主题在未配置 SearXNG 时返回空数组
      return Response.json(
        {
          blogs: [],
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
      console.error('Discover searxng failed, fallback to demo', err);
      return Response.json(
        {
          blogs: DEMO_FINANCE_BLOGS,
        },
        { status: 200 },
      );
    }

    return Response.json(
      {
        blogs: data,
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
