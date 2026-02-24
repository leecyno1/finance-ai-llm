import { getSearxngURL } from './config/serverRegistry';

interface SearxngSearchOptions {
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

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
) => {
  const searxngURL = getSearxngURL();
  if (!searxngURL) {
    return { results: [] as SearxngSearchResult[], suggestions: [] as string[] };
  }
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
    q: string,
    effectiveOpts: SearxngSearchOptions,
  ): Promise<{ results: SearxngSearchResult[]; suggestions: string[] }> => {
    const url = new URL(`${searxngURL}/search?format=json`);
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
    const timeout = setTimeout(() => controller.abort(), 12000);

    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(
        `SearXNG request failed with status ${res.status} for ${url.toString()}`,
      );
    }

    const data = await res.json();
    const results: SearxngSearchResult[] = Array.isArray(data.results)
      ? data.results
      : [];
    const suggestions: string[] = Array.isArray(data.suggestions)
      ? data.suggestions
      : [];

    return { results, suggestions };
  };

  let lastSuccessful: { results: SearxngSearchResult[]; suggestions: string[] } =
    { results: [], suggestions: [] };
  let lastError: unknown = null;

  for (const attempt of attemptOptions) {
    try {
      const primary = await runAttempt(normalizedQuery, attempt);
      if (primary.results.length > 0) return primary;
      lastSuccessful = primary;

      if (fallbackQuery && fallbackQuery !== normalizedQuery) {
        const secondary = await runAttempt(fallbackQuery, attempt);
        if (secondary.results.length > 0) return secondary;
        lastSuccessful = secondary;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    console.error('[searxng] search failed after retries:', lastError);
  }

  return lastSuccessful;
};
