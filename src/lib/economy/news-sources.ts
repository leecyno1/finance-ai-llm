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

export type NewsSourceErrorType =
  | 'timeout'
  | 'network'
  | 'http'
  | 'parse'
  | 'content_type'
  | 'circuit_open'
  | 'unknown';

export type NewsSourceStat = {
  name: string;
  ok: boolean;
  count: number;
  latencyMs: number;
  error?: string;
  errorType?: NewsSourceErrorType;
  status?: 'ok' | 'failed' | 'skipped';
  attempts?: number;
};

export type AggregateNewsResult = {
  items: NewsItem[];
  sourceStats: NewsSourceStat[];
  totalFetched: number;
  dedupedCount: number;
};

export type NewsSourceHealth = {
  name: string;
  configuredEnabled: boolean;
  circuitOpen: boolean;
  consecutiveFailures: number;
  disabledUntil?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastErrorType?: NewsSourceErrorType;
  lastLatencyMs?: number;
};

type InternalHealthState = {
  consecutiveFailures: number;
  disabledUntil?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastErrorType?: NewsSourceErrorType;
  lastLatencyMs?: number;
};

type FetchRequestOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  expectJsonContentType?: boolean;
};

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
};

const SOURCE_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.NEWS_SOURCE_TIMEOUT_MS,
  12_000,
);
const SOURCE_FETCH_RETRIES = parsePositiveInt(process.env.NEWS_SOURCE_RETRIES, 2);
const SOURCE_FAILURE_THRESHOLD = parsePositiveInt(
  process.env.NEWS_SOURCE_FAILURE_THRESHOLD,
  3,
);
const SOURCE_DISABLE_MS = parsePositiveInt(
  process.env.NEWS_SOURCE_DISABLE_MS,
  15 * 60 * 1000,
);

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept: 'application/json,*/*;q=0.9',
};

const sourceHealthStore = new Map<string, InternalHealthState>();

class NewsSourceError extends Error {
  readonly type: NewsSourceErrorType;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    type: NewsSourceErrorType,
    message: string,
    opts?: { status?: number; retryable?: boolean },
  ) {
    super(message);
    this.name = 'NewsSourceError';
    this.type = type;
    this.status = opts?.status;
    this.retryable =
      opts?.retryable ?? (type === 'timeout' || type === 'network');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getOrInitHealthState = (sourceName: string): InternalHealthState => {
  const state = sourceHealthStore.get(sourceName);
  if (state) return state;
  const created: InternalHealthState = { consecutiveFailures: 0 };
  sourceHealthStore.set(sourceName, created);
  return created;
};

const isSourceCircuitOpen = (sourceName: string): boolean => {
  const state = getOrInitHealthState(sourceName);
  return Boolean(state.disabledUntil && state.disabledUntil > Date.now());
};

const markSourceSuccess = (sourceName: string, latencyMs: number) => {
  const state = getOrInitHealthState(sourceName);
  state.consecutiveFailures = 0;
  state.disabledUntil = undefined;
  state.lastSuccessAt = Date.now();
  state.lastLatencyMs = latencyMs;
};

const markSourceFailure = (
  sourceName: string,
  error: NewsSourceError,
  latencyMs: number,
) => {
  const state = getOrInitHealthState(sourceName);
  state.consecutiveFailures += 1;
  state.lastError = error.message;
  state.lastErrorType = error.type;
  state.lastErrorAt = Date.now();
  state.lastLatencyMs = latencyMs;

  if (state.consecutiveFailures >= SOURCE_FAILURE_THRESHOLD) {
    state.disabledUntil = Date.now() + SOURCE_DISABLE_MS;
  }
};

export const getNewsSourceHealth = (): NewsSourceHealth[] => {
  const now = Date.now();
  return NEWS_SOURCES.map((source) => {
    const state = getOrInitHealthState(source.name);
    return {
      name: source.name,
      configuredEnabled: source.enabled,
      circuitOpen: Boolean(state.disabledUntil && state.disabledUntil > now),
      consecutiveFailures: state.consecutiveFailures,
      disabledUntil: state.disabledUntil,
      lastSuccessAt: state.lastSuccessAt,
      lastErrorAt: state.lastErrorAt,
      lastError: state.lastError,
      lastErrorType: state.lastErrorType,
      lastLatencyMs: state.lastLatencyMs,
    };
  });
};

const withTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeSourceError = (
  error: unknown,
  fallbackMessage = 'unknown source error',
): NewsSourceError => {
  if (error instanceof NewsSourceError) return error;

  const message = error instanceof Error ? error.message : String(error || fallbackMessage);

  if (error instanceof Error && error.name === 'AbortError') {
    return new NewsSourceError('timeout', message || 'request timeout', {
      retryable: true,
    });
  }

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)) {
    return new NewsSourceError('network', message, { retryable: true });
  }

  return new NewsSourceError('unknown', message, { retryable: false });
};

const requestText = async (
  sourceName: string,
  url: string,
  options: FetchRequestOptions,
): Promise<{ text: string; attempts: number }> => {
  const retries = Math.max(1, options.retries ?? SOURCE_FETCH_RETRIES);
  const timeoutMs = Math.max(1000, options.timeoutMs ?? SOURCE_FETCH_TIMEOUT_MS);

  let lastError: NewsSourceError | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await withTimeout(
        url,
        {
          headers: {
            ...DEFAULT_HEADERS,
            ...(options.headers || {}),
          },
        },
        timeoutMs,
      );

      if (!response.ok) {
        const err = new NewsSourceError(
          'http',
          `${sourceName} HTTP ${response.status}`,
          {
            status: response.status,
            retryable: RETRYABLE_STATUS.has(response.status),
          },
        );
        if (attempt < retries && err.retryable) {
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      }

      if (options.expectJsonContentType) {
        const contentType = response.headers.get('content-type') || '';
        const isJsonLike =
          contentType.includes('application/json') ||
          contentType.includes('text/json') ||
          contentType.includes('application/javascript') ||
          contentType.includes('text/javascript') ||
          contentType.includes('text/plain');
        if (!isJsonLike) {
          throw new NewsSourceError(
            'content_type',
            `${sourceName} unexpected content-type: ${contentType || 'unknown'}`,
            { retryable: false },
          );
        }
      }

      const text = await response.text();
      if (!text.trim()) {
        throw new NewsSourceError('parse', `${sourceName} empty response`, {
          retryable: true,
        });
      }

      return { text, attempts: attempt };
    } catch (error) {
      const normalized = normalizeSourceError(error, `${sourceName} request failed`);
      lastError = normalized;

      if (attempt < retries && normalized.retryable) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }

  throw lastError || new NewsSourceError('unknown', `${sourceName} request failed`);
};

const parseJsonSafely = <T>(sourceName: string, text: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NewsSourceError('parse', `${sourceName} failed to parse JSON`, {
      retryable: false,
    });
  }
};

const fetchJsonWithRetry = async <T>(
  sourceName: string,
  url: string,
  options: FetchRequestOptions = {},
): Promise<{ data: T; attempts: number }> => {
  const { text, attempts } = await requestText(sourceName, url, {
    ...options,
    expectJsonContentType: true,
  });
  return {
    data: parseJsonSafely<T>(sourceName, text),
    attempts,
  };
};

const extractJsonFromJsonp = (sourceName: string, text: string) => {
  const jsonMatch = text.match(/\{.*\}/s);
  if (!jsonMatch) {
    throw new NewsSourceError('parse', `${sourceName} failed to parse JSONP`, {
      retryable: false,
    });
  }
  return parseJsonSafely<any>(sourceName, jsonMatch[0]);
};

/**
 * 雪球财经新闻抓取
 */
const fetchXueqiuNews = async (): Promise<NewsItem[]> => {
  const { data } = await fetchJsonWithRetry<any>(
    '雪球',
    'https://xueqiu.com/statuses/hot/listV2.json?since_id=-1&max_id=-1&size=20',
    {
      headers: { Accept: 'application/json' },
    },
  );

  const items = data?.items || [];

  return items.map((item: any) => ({
    id: `xueqiu-${item.id}`,
    title:
      item.title ||
      item.description?.replace(/<[^>]*>/g, '').substring(0, 100) ||
      '无标题',
    source: '雪球',
    sourceUrl: `https://xueqiu.com${item.target}`,
    publishTime: new Date(item.created_at).toISOString(),
    timestamp: item.created_at,
    summary: item.description?.replace(/<[^>]*>/g, '').substring(0, 200),
    importance: item.fav_count > 100 ? 'high' : item.fav_count > 50 ? 'medium' : 'low',
  }));
};

/**
 * 东方财富快讯抓取
 */
const fetchEastmoneyNews = async (): Promise<NewsItem[]> => {
  const { data } = await fetchJsonWithRetry<any>(
    '东方财富',
    'https://np-anotice-stock.eastmoney.com/api/content/ann?client_source=wap&page_size=20&page_index=1&market_type=&filter_risk=&begin_time=&end_time=',
    {
      headers: { Accept: 'application/json' },
    },
  );

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
};

/**
 * 财联社快讯抓取
 */
const fetchCailianpressNews = async (): Promise<NewsItem[]> => {
  const timestamp = Date.now();
  const { data } = await fetchJsonWithRetry<any>(
    '财联社',
    `https://www.cls.cn/api/sw?app=CailianpressWeb&os=web&sv=7.7.5&way=telegraph&rn=20&last_time=${timestamp}`,
    {
      headers: { Accept: 'application/json' },
    },
  );

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
};

/**
 * 华尔街见闻快讯抓取
 */
const fetchWallstreetcnNews = async (): Promise<NewsItem[]> => {
  const { data } = await fetchJsonWithRetry<any>(
    '华尔街见闻',
    'https://api-one-wscn.awtmt.com/apiv1/content/lives/latest?channel=global-channel&client=pc&limit=20',
    {
      headers: { Accept: 'application/json' },
    },
  );

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
};

/**
 * 第一财经快讯抓取
 */
const fetchYicaiNews = async (): Promise<NewsItem[]> => {
  const { data } = await fetchJsonWithRetry<any>(
    '第一财经',
    'https://www.yicai.com/api/ajax/getlatest?page=1&pagesize=20',
    {
      headers: { Accept: 'application/json' },
    },
  );

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
};

/**
 * 新浪财经快讯抓取
 */
const fetchSinaFinanceNews = async (): Promise<NewsItem[]> => {
  const { text } = await requestText(
    '新浪财经',
    'https://finance.sina.com.cn/7x24/?format=js&page=1&num=20',
    {
      headers: { Accept: '*/*' },
      expectJsonContentType: false,
    },
  );

  const data = extractJsonFromJsonp('新浪财经', text);
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
};

/**
 * 同花顺财经快讯抓取
 */
const fetchThsNews = async (): Promise<NewsItem[]> => {
  const { data } = await fetchJsonWithRetry<any>(
    '同花顺',
    'https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&limit=20',
    {
      headers: { Accept: 'application/json' },
    },
  );

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
export const aggregateNewsDetailed = async (): Promise<AggregateNewsResult> => {
  const configuredSources = NEWS_SOURCES.filter((s) => s.enabled);
  const runnableSources: NewsSourceConfig[] = [];
  const sourceStats: NewsSourceStat[] = [];

  for (const source of configuredSources) {
    if (isSourceCircuitOpen(source.name)) {
      const health = getOrInitHealthState(source.name);
      sourceStats.push({
        name: source.name,
        ok: false,
        count: 0,
        latencyMs: 0,
        status: 'skipped',
        errorType: 'circuit_open',
        error: `circuit open until ${new Date(health.disabledUntil || Date.now()).toISOString()}`,
      });
      continue;
    }

    runnableSources.push(source);
  }

  const results = await Promise.allSettled(
    runnableSources.map(async (source) => {
      const startedAt = Date.now();
      try {
        const items = await source.fetchFn();
        const latencyMs = Date.now() - startedAt;
        markSourceSuccess(source.name, latencyMs);

        return {
          source: source.name,
          items,
          latencyMs,
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const normalized = normalizeSourceError(error, `${source.name} failed`);
        markSourceFailure(source.name, normalized, latencyMs);
        throw {
          source: source.name,
          error: normalized,
          latencyMs,
        };
      }
    }),
  );

  const allNews: NewsItem[] = [];

  results.forEach((result, index) => {
    const sourceName = runnableSources[index].name;
    if (result.status === 'fulfilled') {
      const items = result.value.items;
      allNews.push(...items);
      sourceStats.push({
        name: sourceName,
        ok: true,
        count: items.length,
        latencyMs: result.value.latencyMs,
        status: 'ok',
      });
      console.log(`✓ ${sourceName}: ${items.length} items`);
      return;
    }

    const reason = result.reason as {
      source?: string;
      error?: unknown;
      latencyMs?: number;
    };
    const normalized = normalizeSourceError(reason?.error || result.reason, `${sourceName} failed`);
    sourceStats.push({
      name: reason?.source || sourceName,
      ok: false,
      count: 0,
      latencyMs: typeof reason?.latencyMs === 'number' ? reason.latencyMs : 0,
      status: 'failed',
      errorType: normalized.type,
      error: normalized.message,
    });
    console.error(`✗ ${sourceName} failed:`, normalized.message);
  });

  const deduped = deduplicateNews(allNews);
  deduped.sort((a, b) => b.timestamp - a.timestamp);

  return {
    items: deduped,
    sourceStats,
    totalFetched: allNews.length,
    dedupedCount: deduped.length,
  };
};

export const aggregateNews = async (): Promise<NewsItem[]> => {
  const detailed = await aggregateNewsDetailed();
  return detailed.items;
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
          (item.importance === 'high' && existing.importance !== 'high') ||
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
    const distance = levenshteinDistance(
      str1.substring(0, 30),
      str2.substring(0, 30),
    );
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
