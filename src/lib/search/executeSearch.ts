import { Document } from '@langchain/core/documents';
import type { SearxngSearchResult, SearxngSearchOptions } from '@/lib/searxng';
import { searchSearxng } from '@/lib/searxng';
import { searchTavily } from '@/lib/tavily';
import Scraper from '@/lib/scraper';

const MAX_RESULTS = 12;
const MAX_SCRAPE_RESULTS = 3;
const MAX_RESULT_CONTENT_CHARS = 4_000;
const MAX_TOTAL_CONTENT_CHARS = 18_000;

type ExecuteSearchMode =
  | 'web'
  | 'academic'
  | 'social'
  | 'multimodal'
  | 'finance';

type ExecuteSearchConstraints = {
  engines?: string[];
  language?: string;
  useTavily?: boolean;
  allowScrape?: boolean;
};

type ExecuteSearchInput = string | string[] | null | undefined;

type ExecuteSearchResult = {
  query: string;
  docs: Document[];
  scrapedDocs: Document[];
  results: SearxngSearchResult[];
  suggestions: string[];
};

const compactText = (input: string, maxChars: number) =>
  String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);

const normalizeQuery = (input: ExecuteSearchInput) => {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  return String(input || '').trim();
};

const buildDocFromResult = (
  result: SearxngSearchResult,
  source: 'searxng' | 'tavily',
) =>
  new Document({
    pageContent: compactText(result.content || result.title || result.url, MAX_RESULT_CONTENT_CHARS),
    metadata: {
      title: result.title,
      url: result.url,
      source,
      ...(result.img_src ? { img_src: result.img_src } : {}),
    },
  });

const truncateDocsBudget = (docs: Document[], maxChars = MAX_TOTAL_CONTENT_CHARS) => {
  const output: Document[] = [];
  let used = 0;

  for (const doc of docs) {
    const content = compactText(doc.pageContent || '', MAX_RESULT_CONTENT_CHARS);
    if (!content) continue;
    if (used >= maxChars) break;

    const remaining = maxChars - used;
    const nextContent = content.slice(0, remaining);
    if (!nextContent.trim()) break;

    output.push(
      new Document({
        pageContent: nextContent,
        metadata: doc.metadata,
      }),
    );
    used += nextContent.length;
  }

  return output;
};

const dedupeDocs = (docs: Document[]) => {
  const seen = new Set<string>();
  const output: Document[] = [];

  for (const doc of docs) {
    const key = `${String(doc.metadata?.url || '').toLowerCase()}::${String(doc.metadata?.title || '')
      .toLowerCase()
      .trim()}`;
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    output.push(doc);
  }

  return output;
};

const shouldScrapeResult = (doc: Document) => {
  const content = compactText(doc.pageContent || '', MAX_RESULT_CONTENT_CHARS);
  return content.length > 0 && content.length < 180;
};

const scrapeDocs = async (docs: Document[]) => {
  const scrapeTargets = docs
    .filter(shouldScrapeResult)
    .slice(0, MAX_SCRAPE_RESULTS);

  const scraped = await Promise.all(
    scrapeTargets.map(async (doc) => {
      const url = String(doc.metadata?.url || '').trim();
      if (!url) return null;

      try {
        const result = await Scraper.scrape(url);
        return new Document({
          pageContent: compactText(result.content, MAX_RESULT_CONTENT_CHARS),
          metadata: {
            ...doc.metadata,
            ...result.metadata,
            title: result.title || doc.metadata?.title,
            url,
          },
        });
      } catch {
        return null;
      }
    }),
  );

  return scraped.filter(Boolean) as Document[];
};

const searchViaTavily = async (query: string) => {
  try {
    const res = await searchTavily(query, { topic: 'news' });
    return (res.results || []).map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      img_src: (result as any).img_src,
    })) as SearxngSearchResult[];
  } catch {
    return [];
  }
};

export const executeSearch = async (
  input: ExecuteSearchInput,
  mode: ExecuteSearchMode,
  constraints: ExecuteSearchConstraints = {},
): Promise<ExecuteSearchResult> => {
  const query = normalizeQuery(input).slice(0, 500);
  if (!query) {
    return {
      query: '',
      docs: [],
      scrapedDocs: [],
      results: [],
      suggestions: [],
    };
  }

  const searchOptions: SearxngSearchOptions = {
    engines: constraints.engines || [],
    language: constraints.language,
  };

  const [searxngRes, tavilyResults] = await Promise.all([
    searchSearxng(query, searchOptions).catch(() => ({ results: [], suggestions: [] })),
    constraints.useTavily ? searchViaTavily(query) : Promise.resolve([]),
  ]);

  const normalizedResults = dedupeDocs(
    [
      ...searxngRes.results.map((result) => buildDocFromResult(result, 'searxng')),
      ...tavilyResults.map((result) => buildDocFromResult(result, 'tavily')),
    ].slice(0, MAX_RESULTS),
  );

  const scrapedDocs =
    constraints.allowScrape && mode !== 'multimodal'
      ? await scrapeDocs(normalizedResults)
      : [];

  const docs = truncateDocsBudget(
    dedupeDocs([...scrapedDocs, ...normalizedResults]),
  );

  return {
    query,
    docs,
    scrapedDocs,
    results: searxngRes.results.slice(0, MAX_RESULTS),
    suggestions: searxngRes.suggestions || [],
  };
};

export type {
  ExecuteSearchConstraints,
  ExecuteSearchInput,
  ExecuteSearchMode,
  ExecuteSearchResult,
};
