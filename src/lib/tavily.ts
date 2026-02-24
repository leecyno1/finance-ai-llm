import { getTavilyApiKey, getTavilyMaxResults } from './config/serverRegistry';

export interface TavilySearchResult {
  title: string;
  url: string;
  content?: string;
  img_src?: string;
  score?: number;
}

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
    score?: number;
    images?: string[];
  }>;
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

const withTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeResult = (
  item: NonNullable<TavilyResponse['results']>[number],
): TavilySearchResult | null => {
  const title = String(item.title ?? '').trim();
  const url = String(item.url ?? '').trim();
  if (!title || !url) return null;

  const content = String(item.content ?? item.raw_content ?? '').trim();
  const image = Array.isArray(item.images) ? item.images[0] : undefined;

  return {
    title,
    url,
    content,
    img_src: image,
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : undefined,
  };
};

export const searchTavily = async (
  query: string,
  opts?: { maxResults?: number; topic?: 'news' | 'general' },
) => {
  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    return { results: [] as TavilySearchResult[] };
  }

  const maxResults = Math.max(
    1,
    Math.min(10, Math.floor(opts?.maxResults ?? getTavilyMaxResults())),
  );
  const topic = opts?.topic ?? 'general';

  const body = {
    api_key: apiKey,
    query,
    search_depth: 'basic',
    include_images: true,
    include_answer: false,
    max_results: maxResults,
    topic,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await withTimeout(
        TAVILY_ENDPOINT,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        },
        12_000,
      );

      if (!res.ok) {
        throw new Error(`Tavily HTTP ${res.status}`);
      }

      const json = (await res.json()) as TavilyResponse;
      const normalized = (json.results ?? [])
        .map(normalizeResult)
        .filter((item): item is TavilySearchResult => Boolean(item));

      return { results: normalized };
    } catch (err) {
      lastError = err;
    }
  }

  console.error('[tavily] search failed:', lastError);
  return { results: [] as TavilySearchResult[] };
};

