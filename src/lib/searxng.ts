import { getSearxngURLs } from './config/serverRegistry';

export interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
}

export interface SearxngSearchResult {
  title: string;
  url: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
}

const ENDPOINT_COOLDOWN_MS = 120_000;
const endpointCooldownUntil = new Map<string, number>();

const now = () => Date.now();

const isEndpointCoolingDown = (endpoint: string) =>
  (endpointCooldownUntil.get(endpoint) ?? 0) > now();

const markEndpointFailure = (endpoint: string) => {
  endpointCooldownUntil.set(endpoint, now() + ENDPOINT_COOLDOWN_MS);
};

const clearEndpointFailure = (endpoint: string) => {
  endpointCooldownUntil.delete(endpoint);
};

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
) => {
  const configuredUrls = getSearxngURLs();
  if (!configuredUrls.length) {
    return { results: [] as SearxngSearchResult[], suggestions: [] as string[] };
  }
  const availableUrls = configuredUrls.filter(
    (url) => !isEndpointCoolingDown(url),
  );
  const searxngURLs =
    availableUrls.length > 0 ? availableUrls : configuredUrls;
  const normalizedQuery = String(query ?? '').trim();
  const fallbackQuery = normalizedQuery.replace(/["'`]/g, ' ').replace(/\s+/g, ' ').trim();

  const attemptOptions: SearxngSearchOptions[] = [
    {
      ...opts,
    },
  ];

  const hasEngineConstraint = (opts?.engines?.length ?? 0) > 0;
  if (!hasEngineConstraint) {
    attemptOptions.push({
      ...opts,
      language: opts?.language || 'all',
    });
    attemptOptions.push({
      ...opts,
      language: opts?.language === 'en' ? 'zh-CN' : 'en',
    });
  }

  const runAttempt = async (
    endpoint: string,
    q: string,
    effectiveOpts: SearxngSearchOptions,
  ): Promise<{ results: SearxngSearchResult[]; suggestions: string[] }> => {
    const url = new URL(`${endpoint}/search?format=json`);
    url.searchParams.append('q', q);

    Object.keys(effectiveOpts).forEach((key) => {
      const value = effectiveOpts[key as keyof SearxngSearchOptions];
      if (value == null || value === '') return;

      if (Array.isArray(value)) {
        if (!value.length) return;
        url.searchParams.append(key, value.join(','));
        return;
      }
      url.searchParams.append(key, String(value));
    });

    // 为避免远程 SearXNG 不可用时长时间挂起，这里增加较短的超时控制。
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
          accept: 'application/json,text/plain,*/*',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`SearXNG search timed out for ${endpoint}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(
        `SearXNG request failed with status ${res.status} for ${url.toString()}`,
      );
    }

    const data = await res.json().catch((err) => {
      throw new Error(
        `SearXNG returned invalid JSON for ${endpoint}: ${String(err?.message || err)}`,
      );
    });
    const results: SearxngSearchResult[] = Array.isArray(data.results)
      ? data.results
      : [];
    const suggestions: string[] = Array.isArray(data.suggestions)
      ? data.suggestions
      : [];

    if (!Array.isArray(data.results) && !Array.isArray(data.suggestions)) {
      throw new Error(`SearXNG returned invalid payload shape for ${endpoint}`);
    }

    return { results, suggestions };
  };

  let lastSuccessful: { results: SearxngSearchResult[]; suggestions: string[] } =
    { results: [], suggestions: [] };
  let lastError: unknown = null;

  for (const endpoint of searxngURLs) {
    for (const attempt of attemptOptions) {
      try {
        const primary = await runAttempt(endpoint, normalizedQuery, attempt);
        clearEndpointFailure(endpoint);
        if (primary.results.length > 0) return primary;
        lastSuccessful = primary;

        if (fallbackQuery && fallbackQuery !== normalizedQuery) {
          const secondary = await runAttempt(endpoint, fallbackQuery, attempt);
          clearEndpointFailure(endpoint);
          if (secondary.results.length > 0) return secondary;
          lastSuccessful = secondary;
        }
      } catch (err) {
        lastError = err;
        markEndpointFailure(endpoint);
      }
    }
  }

  if (lastError) {
    console.error('[searxng] search failed after retries:', lastError);
  }

  return lastSuccessful;
};
