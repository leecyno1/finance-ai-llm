import { getCacheObservability } from '@/lib/cache/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODULES = new Set([
  'news_finance',
  'economy_news',
  'discover',
  'event_impact',
] as const);

const parseSlotMs = (slot: string): number => {
  // Slot format: YYYY-MM-DDTHH
  const m = String(slot || '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/,
  );
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const h = Number(m[4]);
  const dt = new Date(y, mo, d, h, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
};

const parseWindowHours = (value: string | null): number => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 0;
  const m = raw.match(/^(\d+)(h)?$/);
  if (!m) return 0;
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(24 * 30, num);
};

const parsePositiveNumber = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
};

export const GET = async (req: Request) => {
  try {
    const full = getCacheObservability() as any;
    const url = new URL(req.url);
    const moduleParamRaw = String(url.searchParams.get('module') || 'all').trim();
    const moduleParam =
      moduleParamRaw !== 'all' && MODULES.has(moduleParamRaw as any)
        ? moduleParamRaw
        : 'all';
    const topNRaw = Number(url.searchParams.get('topN') || 12);
    const topN =
      Number.isFinite(topNRaw) && topNRaw > 0 ? Math.min(50, Math.floor(topNRaw)) : 12;
    const windowHours = parseWindowHours(url.searchParams.get('windowHours'));
    const cutoff = windowHours > 0 ? Date.now() - windowHours * 60 * 60 * 1000 : 0;
    const thresholds = {
      hitRateWarn: parsePositiveNumber(
        process.env.CACHE_HIT_RATE_WARN_PCT,
        55,
        1,
        99,
      ),
      recomputeAvgWarnMs: parsePositiveNumber(
        process.env.CACHE_RECOMPUTE_AVG_WARN_MS,
        15000,
        100,
        600000,
      ),
      recomputeMaxWarnMs: parsePositiveNumber(
        process.env.CACHE_RECOMPUTE_MAX_WARN_MS,
        30000,
        100,
        1200000,
      ),
    };

    let rows = Array.isArray(full?.slowRecomputeTop) ? full.slowRecomputeTop : [];

    if (moduleParam !== 'all' && MODULES.has(moduleParam as any)) {
      rows = rows.filter((x: any) => String(x?.module) === moduleParam);
    }

    if (windowHours > 0) {
      rows = rows.filter((x: any) => {
        const ts = parseSlotMs(String(x?.slot || ''));
        return ts > 0 && ts >= cutoff;
      });
    }

    const modules = full?.modules && typeof full.modules === 'object' ? full.modules : {};
    const selectedModules =
      moduleParam === 'all'
        ? (Array.from(MODULES) as string[])
        : [moduleParam];

    const trendSeries = selectedModules.reduce(
      (acc, key) => {
        const slotRows = Array.isArray(modules?.[key]?.slots) ? modules[key].slots : [];
        const filteredRows =
          cutoff > 0
            ? slotRows.filter((row: any) => {
                const ts = parseSlotMs(String(row?.slot || ''));
                return ts > 0 && ts >= cutoff;
              })
            : slotRows;

        acc[key] = filteredRows
          .map((row: any) => ({
            slot: String(row?.slot || ''),
            ts: parseSlotMs(String(row?.slot || '')),
            requests: Number(row?.requests || 0),
            hits: Number(row?.hits || 0),
            misses: Number(row?.misses || 0),
            hitRate: Number(row?.hitRate || 0),
            recomputeAvgMs: Number(row?.recomputeAvgMs || 0),
            recomputeMaxMs: Number(row?.recomputeMaxMs || 0),
          }))
          .filter((row: any) => row.ts > 0)
          .sort((a: any, b: any) => a.ts - b.ts);
        return acc;
      },
      {} as Record<
        string,
        Array<{
          slot: string;
          ts: number;
          requests: number;
          hits: number;
          misses: number;
          hitRate: number;
          recomputeAvgMs: number;
          recomputeMaxMs: number;
        }>
      >,
    );

    return Response.json(
      {
        ...full,
        filter: {
          module: moduleParam,
          windowHours,
          topN,
        },
        thresholds,
        trendSeries,
        slowRecomputeTop: rows.slice(0, topN),
      },
      { status: 200 },
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        message: err?.message || 'failed to read cache observability',
      },
      { status: 500 },
    );
  }
};
