import fs from 'fs';
import path from 'node:path';

export type CacheModuleKey =
  | 'news_finance'
  | 'economy_news'
  | 'discover'
  | 'event_impact';

type SlotObservability = {
  requests: number;
  hits: number;
  misses: number;
  recomputeCount: number;
  recomputeMsTotal: number;
  recomputeMsMax: number;
  sampleSizeLast: number;
  updatedAt: number;
  lastHitAt?: number;
  lastMissAt?: number;
};

type ModuleObservability = {
  slots: Record<string, SlotObservability>;
};

type CacheObservabilityPayload = {
  version: number;
  updatedAt: number;
  modules: Record<CacheModuleKey, ModuleObservability>;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const OBSERVABILITY_PATH = path.join(DATA_DIR, 'data/cache-observability.json');
const OBSERVABILITY_VERSION = 1;
const MAX_SLOT_RECORDS = 28;

const ALL_MODULES: CacheModuleKey[] = [
  'news_finance',
  'economy_news',
  'discover',
  'event_impact',
];

const pad = (n: number) => String(n).padStart(2, '0');

export const getSixHourSlotLabel = (d: Date) => {
  const local = new Date(d.getTime());
  const slotHour = local.getHours() - (local.getHours() % 6);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(slotHour)}`;
};

const emptyPayload = (): CacheObservabilityPayload => ({
  version: OBSERVABILITY_VERSION,
  updatedAt: Date.now(),
  modules: {
    news_finance: { slots: {} },
    economy_news: { slots: {} },
    discover: { slots: {} },
    event_impact: { slots: {} },
  },
});

const loadPayload = (): CacheObservabilityPayload => {
  try {
    if (!fs.existsSync(OBSERVABILITY_PATH)) return emptyPayload();
    const raw = fs.readFileSync(OBSERVABILITY_PATH, 'utf8');
    if (!raw.trim()) return emptyPayload();
    const parsed = JSON.parse(raw) as CacheObservabilityPayload;
    if (!parsed || parsed.version !== OBSERVABILITY_VERSION) return emptyPayload();
    if (!parsed.modules || typeof parsed.modules !== 'object') return emptyPayload();

    const base = emptyPayload();
    for (const key of ALL_MODULES) {
      const slots = parsed.modules[key]?.slots;
      base.modules[key].slots = slots && typeof slots === 'object' ? slots : {};
    }
    base.updatedAt = Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : Date.now();
    return base;
  } catch {
    return emptyPayload();
  }
};

const savePayload = (payload: CacheObservabilityPayload) => {
  try {
    const dir = path.dirname(OBSERVABILITY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OBSERVABILITY_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write cache observability', err);
  }
};

const ensureSlotStat = (slots: Record<string, SlotObservability>, slot: string) => {
  if (!slots[slot]) {
    slots[slot] = {
      requests: 0,
      hits: 0,
      misses: 0,
      recomputeCount: 0,
      recomputeMsTotal: 0,
      recomputeMsMax: 0,
      sampleSizeLast: 0,
      updatedAt: Date.now(),
    };
  }
  return slots[slot];
};

const pruneSlots = (slots: Record<string, SlotObservability>) => {
  const keys = Object.keys(slots).sort((a, b) => b.localeCompare(a));
  keys.slice(MAX_SLOT_RECORDS).forEach((k) => delete slots[k]);
};

export const recordCacheObservation = (params: {
  module: CacheModuleKey;
  slot?: string;
  cached: boolean;
  recomputeMs?: number;
  sampleSize?: number;
}) => {
  const payload = loadPayload();
  const slot = params.slot || getSixHourSlotLabel(new Date());
  const moduleData = payload.modules[params.module];
  const stat = ensureSlotStat(moduleData.slots, slot);
  const now = Date.now();

  stat.requests += 1;
  if (params.cached) {
    stat.hits += 1;
    stat.lastHitAt = now;
  } else {
    stat.misses += 1;
    stat.lastMissAt = now;
    if (Number.isFinite(params.recomputeMs) && Number(params.recomputeMs) >= 0) {
      const ms = Number(params.recomputeMs);
      stat.recomputeCount += 1;
      stat.recomputeMsTotal += ms;
      stat.recomputeMsMax = Math.max(stat.recomputeMsMax, ms);
    }
  }

  if (Number.isFinite(params.sampleSize) && Number(params.sampleSize) >= 0) {
    stat.sampleSizeLast = Number(params.sampleSize);
  }
  stat.updatedAt = now;
  pruneSlots(moduleData.slots);
  payload.updatedAt = now;
  savePayload(payload);
};

export const getCacheObservability = () => {
  const payload = loadPayload();
  const currentSlot = getSixHourSlotLabel(new Date());

  const modules = ALL_MODULES.reduce(
    (acc, moduleKey) => {
      const slotRows = Object.entries(payload.modules[moduleKey].slots)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([slot, row]) => {
          const hitRate = row.requests > 0 ? row.hits / row.requests : 0;
          const recomputeAvgMs =
            row.recomputeCount > 0 ? row.recomputeMsTotal / row.recomputeCount : 0;
          return {
            slot,
            requests: row.requests,
            hits: row.hits,
            misses: row.misses,
            hitRate: Number((hitRate * 100).toFixed(1)),
            recomputeAvgMs: Number(recomputeAvgMs.toFixed(1)),
            recomputeMaxMs: Number(row.recomputeMsMax.toFixed(1)),
            sampleSizeLast: row.sampleSizeLast,
            updatedAt: row.updatedAt,
            lastHitAt: row.lastHitAt || 0,
            lastMissAt: row.lastMissAt || 0,
          };
        });

      const totals = slotRows.reduce(
        (s, x) => {
          s.requests += x.requests;
          s.hits += x.hits;
          s.misses += x.misses;
          return s;
        },
        { requests: 0, hits: 0, misses: 0 },
      );
      const totalHitRate =
        totals.requests > 0 ? Number(((totals.hits / totals.requests) * 100).toFixed(1)) : 0;

      acc[moduleKey] = {
        currentSlot,
        totalRequests: totals.requests,
        totalHits: totals.hits,
        totalMisses: totals.misses,
        totalHitRate,
        slots: slotRows,
      };
      return acc;
    },
    {} as Record<
      CacheModuleKey,
      {
        currentSlot: string;
        totalRequests: number;
        totalHits: number;
        totalMisses: number;
        totalHitRate: number;
        slots: Array<{
          slot: string;
          requests: number;
          hits: number;
          misses: number;
          hitRate: number;
          recomputeAvgMs: number;
          recomputeMaxMs: number;
          sampleSizeLast: number;
          updatedAt: number;
          lastHitAt: number;
          lastMissAt: number;
        }>;
      }
    >,
  );

  const slowRecomputeTop = Object.entries(modules)
    .flatMap(([moduleKey, moduleData]) =>
      moduleData.slots
        .filter((slot) => slot.recomputeAvgMs > 0 || slot.recomputeMaxMs > 0)
        .map((slot) => ({
          module: moduleKey as CacheModuleKey,
          slot: slot.slot,
          recomputeAvgMs: slot.recomputeAvgMs,
          recomputeMaxMs: slot.recomputeMaxMs,
          misses: slot.misses,
          sampleSizeLast: slot.sampleSizeLast,
        })),
    )
    .sort((a, b) => {
      if (b.recomputeAvgMs !== a.recomputeAvgMs) return b.recomputeAvgMs - a.recomputeAvgMs;
      if (b.recomputeMaxMs !== a.recomputeMaxMs) return b.recomputeMaxMs - a.recomputeMaxMs;
      return b.misses - a.misses;
    })
    .slice(0, 12);

  return {
    ok: true,
    updatedAt: payload.updatedAt,
    currentSlot,
    modules,
    slowRecomputeTop,
  };
};

export const clearCacheObservability = (modules?: CacheModuleKey[]) => {
  const payload = loadPayload();
  const selected = modules?.length ? modules : ALL_MODULES;
  selected.forEach((m) => {
    if (payload.modules[m]) {
      payload.modules[m].slots = {};
    }
  });
  payload.updatedAt = Date.now();
  savePayload(payload);
};
