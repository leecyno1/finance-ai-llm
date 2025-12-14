/**
 * 真实财经新闻数据源
 * 支持多个财经网站的新闻抓取和聚合
 */

export type NewsItem = {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  publishTime: string; // ISO 8601 format
  timestamp: number;
  summary?: string;
  content?: string;
  tags?: string[];
  importance?: 'high' | 'medium' | 'low';
};

export type NewsSourceConfig = {
  name: string;
  baseUrl: string;
  enabled: boolean;
  fetchFn: () => Promise<NewsItem[]>;
};

/**
 * 雪球财经新闻抓取
 */
const fetchXueqiuNews = async (): Promise<NewsItem[]> => {
  try {
    // 雪球 7x24 快讯 API
    const response = await fetch('https://xueqiu.com/statuses/hot/listV2.json?since_id=-1&max_id=-1&size=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Xueqiu API failed: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.items || [];

    return items.map((item: any) => ({
      id: `xueqiu-${item.id}`,
      title: item.title || item.description?.replace(/<[^>]*>/g, '').substring(0, 100) || '无标题',
      source: '雪球',
      sourceUrl: `https://xueqiu.com${item.target}`,
      publishTime: new Date(item.created_at).toISOString(),
      timestamp: item.created_at,
      summary: item.description?.replace(/<[^>]*>/g, '').substring(0, 200),
      importance: item.fav_count > 100 ? 'high' : item.fav_count > 50 ? 'medium' : 'low',
    }));
  } catch (error) {
    console.error('Failed to fetch Xueqiu news:', error);
    return [];
  }
};

/**
 * 东方财富快讯抓取
 */
const fetchEastmoneyNews = async (): Promise<NewsItem[]> => {
  try {
    // 东方财富 7x24 快讯 API
    const response = await fetch('https://np-anotice-stock.eastmoney.com/api/content/ann?client_source=wap&page_size=20&page_index=1&market_type=&filter_risk=&begin_time=&end_time=', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Eastmoney API failed: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.data?.list || [];

    return items.map((item: any) => ({
      id: `eastmoney-${item.art_code}`,
      title: item.art_title || '无标题',
      source: '东方财富',
      sourceUrl: item.art_url || 'https://www.eastmoney.com',
      publishTime: new Date(item.art_publish_time).toISOString(),
      timestamp: new Date(item.art_publish_time).getTime(),
      summary: item.art_brief || item.art_content?.substring(0, 200),
      tags: item.art_codes?.split(',') || [],
      importance: item.art_is_important === '1' ? 'high' : 'medium',
    }));
  } catch (error) {
    console.error('Failed to fetch Eastmoney news:', error);
    return [];
  }
};

/**
 * 财联社快讯抓取
 */
const fetchCailianpressNews = async (): Promise<NewsItem[]> => {
  try {
    // 财联社电报 API
    const timestamp = Date.now();
    const response = await fetch(`https://www.cls.cn/api/sw?app=CailianpressWeb&os=web&sv=7.7.5&way=telegraph&rn=20&last_time=${timestamp}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Cailianpress API failed: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.data?.telegraph || [];

    return items.map((item: any) => ({
      id: `cailianpress-${item.id}`,
      title: item.title || item.content?.substring(0, 100) || '无标题',
      source: '财联社',
      sourceUrl: `https://www.cls.cn/telegraph/${item.id}`,
      publishTime: new Date(item.ctime * 1000).toISOString(),
      timestamp: item.ctime * 1000,
      summary: item.content?.substring(0, 200),
      tags: item.subjects?.map((s: any) => s.subject_name) || [],
      importance: item.is_important ? 'high' : 'medium',
    }));
  } catch (error) {
    console.error('Failed to fetch Cailianpress news:', error);
    return [];
  }
};

/**
 * 华尔街见闻快讯抓取
 */
const fetchWallstreetcnNews = async (): Promise<NewsItem[]> => {
  try {
    // 华尔街见闻快讯 API
    const response = await fetch('https://api-one-wscn.awtmt.com/apiv1/content/lives/latest?channel=global-channel&client=pc&limit=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Wallstreetcn API failed: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.data?.items || [];

    return items.map((item: any) => ({
      id: `wallstreetcn-${item.id}`,
      title: item.title || item.content_text?.substring(0, 100) || '无标题',
      source: '华尔街见闻',
      sourceUrl: `https://wallstreetcn.com/live/${item.id}`,
      publishTime: new Date(item.display_time * 1000).toISOString(),
      timestamp: item.display_time * 1000,
      summary: item.content_text?.substring(0, 200),
      importance: item.is_important ? 'high' : 'medium',
    }));
  } catch (error) {
    console.error('Failed to fetch Wallstreetcn news:', error);
    return [];
  }
};

/**
 * 第一财经快讯抓取
 */
const fetchYicaiNews = async (): Promise<NewsItem[]> => {
  try {
    // 第一财经快讯 API
    const response = await fetch('https://www.yicai.com/api/ajax/getlatest?page=1&pagesize=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Yicai API failed: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.data || [];

    return items.map((item: any) => ({
      id: `yicai-${item.NewsID}`,
      title: item.Title || '无标题',
      source: '第一财经',
      sourceUrl: item.url || `https://www.yicai.com/news/${item.NewsID}.html`,
      publishTime: new Date(item.CreateTime).toISOString(),
      timestamp: new Date(item.CreateTime).getTime(),
      summary: item.Description?.substring(0, 200),
      tags: item.Keywords?.split(',') || [],
      importance: 'medium',
    }));
  } catch (error) {
    console.error('Failed to fetch Yicai news:', error);
    return [];
  }
};

/**
 * 新浪财经快讯抓取
 */
const fetchSinaFinanceNews = async (): Promise<NewsItem[]> => {
  try {
    // 新浪财经实时快讯 API
    const response = await fetch('https://finance.sina.com.cn/7x24/?format=js&page=1&num=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': '*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Sina Finance API failed: ${response.status}`);
    }

    const text = await response.text();
    // 解析 JSONP 格式
    const jsonMatch = text.match(/\{.*\}/s);
    if (!jsonMatch) {
      throw new Error('Failed to parse Sina Finance response');
    }

    const data = JSON.parse(jsonMatch[0]);
    const items = data?.result?.data || [];

    return items.map((item: any) => ({
      id: `sina-${item.id}`,
      title: item.title || item.content?.substring(0, 100) || '无标题',
      source: '新浪财经',
      sourceUrl: item.url || 'https://finance.sina.com.cn',
      publishTime: new Date(item.create_time * 1000).toISOString(),
      timestamp: item.create_time * 1000,
      summary: item.content?.substring(0, 200),
      importance: item.is_important ? 'high' : 'medium',
    }));
  } catch (error) {
    console.error('Failed to fetch Sina Finance news:', error);
    return [];
  }
};

/**
 * 同花顺财经快讯抓取
 */
const fetchThsNews = async (): Promise<NewsItem[]> => {
  try {
    // 同花顺财经快讯 API
    const response = await fetch('https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&limit=20', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`THS API failed: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.data?.list || [];

    return items.map((item: any) => ({
      id: `ths-${item.id}`,
      title: item.title || '无标题',
      source: '同花顺',
      sourceUrl: item.url || 'https://news.10jqka.com.cn',
      publishTime: new Date(item.ctime * 1000).toISOString(),
      timestamp: item.ctime * 1000,
      summary: item.digest?.substring(0, 200),
      importance: 'medium',
    }));
  } catch (error) {
    console.error('Failed to fetch THS news:', error);
    return [];
  }
};

/**
 * 所有新闻源配置
 */
export const NEWS_SOURCES: NewsSourceConfig[] = [
  {
    name: '财联社',
    baseUrl: 'https://www.cls.cn',
    enabled: true,
    fetchFn: fetchCailianpressNews,
  },
  {
    name: '华尔街见闻',
    baseUrl: 'https://wallstreetcn.com',
    enabled: true,
    fetchFn: fetchWallstreetcnNews,
  },
  {
    name: '东方财富',
    baseUrl: 'https://www.eastmoney.com',
    enabled: true,
    fetchFn: fetchEastmoneyNews,
  },
  {
    name: '雪球',
    baseUrl: 'https://xueqiu.com',
    enabled: true,
    fetchFn: fetchXueqiuNews,
  },
  {
    name: '第一财经',
    baseUrl: 'https://www.yicai.com',
    enabled: true,
    fetchFn: fetchYicaiNews,
  },
  {
    name: '新浪财经',
    baseUrl: 'https://finance.sina.com.cn',
    enabled: true,
    fetchFn: fetchSinaFinanceNews,
  },
  {
    name: '同花顺',
    baseUrl: 'https://news.10jqka.com.cn',
    enabled: true,
    fetchFn: fetchThsNews,
  },
];

/**
 * 聚合所有新闻源的新闻
 */
export const aggregateNews = async (): Promise<NewsItem[]> => {
  const enabledSources = NEWS_SOURCES.filter((s) => s.enabled);

  // 并发抓取所有新闻源
  const results = await Promise.allSettled(
    enabledSources.map((source) => source.fetchFn()),
  );

  // 合并所有成功的结果
  const allNews: NewsItem[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allNews.push(...result.value);
      console.log(`✓ ${enabledSources[index].name}: ${result.value.length} items`);
    } else {
      console.error(`✗ ${enabledSources[index].name} failed:`, result.reason);
    }
  });

  // 去重（基于标题相似度）
  const deduped = deduplicateNews(allNews);

  // 按时间倒序排序
  deduped.sort((a, b) => b.timestamp - a.timestamp);

  return deduped;
};

/**
 * 去重逻辑：基于标题相似度
 */
const deduplicateNews = (news: NewsItem[]): NewsItem[] => {
  const seen = new Map<string, NewsItem>();

  for (const item of news) {
    // 标准化标题用于比较
    const normalizedTitle = item.title
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]/g, '');

    let isDuplicate = false;

    // 检查是否已存在相似标题
    for (const [key, existing] of seen.entries()) {
      if (isSimilar(normalizedTitle, key)) {
        // 如果新闻更重要或更新，则替换
        if (
          item.importance === 'high' && existing.importance !== 'high' ||
          item.timestamp > existing.timestamp
        ) {
          seen.set(key, item);
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(normalizedTitle, item);
    }
  }

  return Array.from(seen.values());
};

/**
 * 简单的字符串相似度判断
 */
const isSimilar = (str1: string, str2: string): boolean => {
  // 如果完全相同
  if (str1 === str2) return true;

  // 如果一个是另一个的子串（长度差异不大）
  const minLen = Math.min(str1.length, str2.length);
  const maxLen = Math.max(str1.length, str2.length);

  if (maxLen - minLen < 5) {
    if (str1.includes(str2) || str2.includes(str1)) return true;
  }

  // 简单的编辑距离判断
  if (minLen > 10) {
    const threshold = Math.floor(minLen * 0.2); // 允许20%差异
    const distance = levenshteinDistance(str1.substring(0, 30), str2.substring(0, 30));
    return distance < threshold;
  }

  return false;
};

/**
 * Levenshtein 距离算法
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[len1][len2];
};
