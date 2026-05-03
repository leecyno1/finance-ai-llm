import fs from 'fs';
import path from 'node:path';
import {
  clearCacheObservability,
  type CacheModuleKey,
} from '@/lib/cache/observability';
import { requireAdmin } from '@/lib/server/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CacheInvalidateScope = CacheModuleKey | 'all';

const DATA_DIR = process.env.DATA_DIR || process.cwd();

const SCOPE_TO_MODULES: Record<CacheInvalidateScope, CacheModuleKey[]> = {
  news_finance: ['news_finance'],
  economy_news: ['economy_news'],
  discover: ['discover'],
  event_impact: ['event_impact'],
  all: ['news_finance', 'economy_news', 'discover', 'event_impact'],
};

const SCOPE_TO_FILES: Record<CacheInvalidateScope, string[]> = {
  news_finance: ['data/news-cache.json'],
  economy_news: ['data/economy-news-cache.json'],
  discover: ['data/discover-cache.json'],
  event_impact: ['data/event-impact-cache.json'],
  all: [
    'data/news-cache.json',
    'data/economy-news-cache.json',
    'data/discover-cache.json',
    'data/event-impact-cache.json',
    'data/economy-cache.json',
    'data/fund/tushare-fund-universe-cache.json',
  ],
};

const SCOPE_TO_WARM_PATHS: Record<CacheInvalidateScope, string[]> = {
  news_finance: ['/api/news/finance'],
  economy_news: ['/api/economy/news'],
  discover: ['/api/discover?topic=finance&lang=zh'],
  event_impact: ['/api/finance/event-impact?limit=120'],
  all: [
    '/api/news/finance',
    '/api/economy/news',
    '/api/discover?topic=finance&lang=zh',
    '/api/finance/event-impact?limit=120',
    '/api/economy/summary',
  ],
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const uniq = (items: string[]) => Array.from(new Set(items));

const resolveScope = (value: unknown): CacheInvalidateScope => {
  const raw = String(value || '').trim().toLowerCase();
  if (
    raw === 'news_finance' ||
    raw === 'economy_news' ||
    raw === 'discover' ||
    raw === 'event_impact' ||
    raw === 'all'
  ) {
    return raw;
  }
  return 'all';
};

const deleteCacheFiles = (relativePaths: string[]) => {
  const deletedFiles: string[] = [];
  const missingFiles: string[] = [];
  const failedFiles: Array<{ file: string; message: string }> = [];

  for (const rel of uniq(relativePaths)) {
    const abs = path.join(DATA_DIR, rel);
    if (!fs.existsSync(abs)) {
      missingFiles.push(rel);
      continue;
    }
    try {
      fs.unlinkSync(abs);
      deletedFiles.push(rel);
    } catch (err: any) {
      failedFiles.push({
        file: rel,
        message: String(err?.message || err || 'unknown error'),
      });
    }
  }

  return { deletedFiles, missingFiles, failedFiles };
};

const warmScope = async (baseUrl: string, scope: CacheInvalidateScope) => {
  const warmResults: Array<{
    path: string;
    ok: boolean;
    status: number;
    durationMs: number;
    message?: string;
  }> = [];

  for (const warmPath of uniq(SCOPE_TO_WARM_PATHS[scope])) {
    const startedAt = Date.now();
    const url = new URL(warmPath, baseUrl).toString();
    try {
      const res = await withTimeout(
        fetch(url, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        }),
        45_000,
      );
      warmResults.push({
        path: warmPath,
        ok: res.ok,
        status: res.status,
        durationMs: Date.now() - startedAt,
      });
    } catch (err: any) {
      warmResults.push({
        path: warmPath,
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        message: String(err?.message || err || 'warm failed'),
      });
    }
  }

  return warmResults;
};

export const POST = async (req: Request) => {
  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const scope = resolveScope(body?.scope);
    const rewarm = Boolean(body?.rewarm);
    const modules = SCOPE_TO_MODULES[scope];
    const files = scope === 'all' ? SCOPE_TO_FILES.all : SCOPE_TO_FILES[scope];

    const { deletedFiles, missingFiles, failedFiles } = deleteCacheFiles(files);
    clearCacheObservability(modules);

    const warmResults = rewarm
      ? await warmScope(new URL(req.url).origin, scope)
      : [];

    return Response.json(
      {
        ok: true,
        scope,
        rewarm,
        clearedModules: modules,
        deletedFiles,
        missingFiles,
        failedFiles,
        warmResults,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        message: err?.message || 'failed to invalidate cache',
      },
      { status: 500 },
    );
  }
};
