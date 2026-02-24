import fs from 'fs';
import path from 'node:path';
import {
  buildEventImpactMatrix,
  EventImpactItem,
  formatEventImpactAsMarkdown,
} from '@/lib/finance/eventImpact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventImpactCache = {
  updatedAt: number;
  newsUpdatedAt: string;
  matrix: EventImpactItem[];
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_PATH = path.join(DATA_DIR, 'data/event-impact-cache.json');
const NEWS_CACHE_PATH = path.join(DATA_DIR, 'data/news-cache.json');
const CACHE_TTL_MS = 10 * 60 * 1000;

const loadCache = (): EventImpactCache | null => {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as EventImpactCache;
    if (!parsed || typeof parsed.updatedAt !== 'number' || !Array.isArray(parsed.matrix)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const saveCache = (cache: EventImpactCache) => {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write event-impact cache', err);
  }
};

const getNewsUpdatedAt = () => {
  try {
    if (!fs.existsSync(NEWS_CACHE_PATH)) return '';
    const raw = fs.readFileSync(NEWS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { updatedAt?: string };
    return String(parsed?.updatedAt || '');
  } catch {
    return '';
  }
};

const normalize = (v: string) =>
  (v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const filterRows = (rows: EventImpactItem[], query: string, limit: number) => {
  const q = normalize(query);
  let out = rows;
  if (q) {
    out = rows.filter((row) => {
      const hay = normalize(
        `${row.event} ${row.sectors.join(' ')} ${row.assets.join(' ')} ${row.source} ${row.matchedKeywords.join(' ')}`,
      );
      return hay.includes(q);
    });
  }
  return out.slice(0, limit);
};

export const GET = async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const limitRaw = Number(searchParams.get('limit') || 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, limitRaw))
      : 20;

    const newsUpdatedAt = getNewsUpdatedAt();
    const cached = loadCache();

    let fullMatrix: EventImpactItem[] = [];
    let fromCache = false;

    const cacheFresh =
      cached &&
      Date.now() - cached.updatedAt < CACHE_TTL_MS &&
      cached.newsUpdatedAt === newsUpdatedAt &&
      cached.matrix.length > 0;

    if (cacheFresh) {
      fullMatrix = cached.matrix;
      fromCache = true;
    } else {
      fullMatrix = buildEventImpactMatrix({ limit: 240 });
      saveCache({
        updatedAt: Date.now(),
        newsUpdatedAt,
        matrix: fullMatrix,
      });
    }

    const matrix = filterRows(fullMatrix, query, limit);

    return Response.json(
      {
        ok: true,
        cached: fromCache,
        updatedAt: Date.now(),
        newsUpdatedAt,
        count: matrix.length,
        total: fullMatrix.length,
        matrix,
        markdown: formatEventImpactAsMarkdown(matrix),
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error in /api/finance/event-impact:', err);
    return Response.json(
      {
        ok: false,
        message: err?.message || 'An error has occurred.',
      },
      { status: 500 },
    );
  }
};
