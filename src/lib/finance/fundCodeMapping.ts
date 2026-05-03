import fs from 'fs';
import path from 'node:path';
import { callTushare, hasTushareToken } from '@/lib/economy/tushare';
import { getLocalFundUniverseWithMeta } from './fundAllocator';

export type FundCodeMapItem = {
  tsCode: string;
  code: string;
  name: string;
  management: string;
  fundType: string;
  market: string;
  status: string;
  listDate: string;
  foundDate: string;
};

type FundCodeMapCache = {
  updatedAt: number;
  source: 'tushare' | 'local' | 'cache' | 'dynamic-cache';
  items: FundCodeMapItem[];
  error?: string;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_PATH = path.join(DATA_DIR, 'data/fund/fund-code-map-cache.json');
const DYNAMIC_UNIVERSE_CACHE_PATH = path.join(
  DATA_DIR,
  'data/fund/tushare-fund-universe-cache.json',
);
const STATIC_DYNAMIC_SNAPSHOT_PATH = path.join(
  process.cwd(),
  'public/fund/tushare-fund-universe-cache.json',
);
const STATIC_DYNAMIC_SRC_SNAPSHOT_PATH = path.join(
  process.cwd(),
  'src/lib/finance/data/tushare-fund-universe-cache.json',
);
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const normalize = (v: string) =>
  String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const normalizeQuery = (v: string) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const loadCache = (): FundCodeMapCache | null => {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as FundCodeMapCache;
    if (!parsed || typeof parsed.updatedAt !== 'number' || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const saveCache = (payload: FundCodeMapCache) => {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write fund-code map cache', err);
  }
};

const dedupeByTsCode = (rows: FundCodeMapItem[]) => {
  const map = new Map<string, FundCodeMapItem>();
  rows.forEach((row) => {
    const tsCode = normalize(row.tsCode);
    if (!tsCode) return;
    if (!map.has(tsCode)) {
      map.set(tsCode, {
        ...row,
        tsCode,
        code: normalize(row.code || tsCode.split('.')[0] || ''),
      });
    }
  });
  return Array.from(map.values());
};

const mapTushareRows = (rows: Record<string, unknown>[]): FundCodeMapItem[] =>
  rows
    .map((r) => {
      const tsCode = normalize(String(r.ts_code || ''));
      const code = normalize(String(r.symbol || tsCode.split('.')[0] || ''));
      const name = String(r.name || '').trim();
      if (!tsCode || !name) return null;
      return {
        tsCode,
        code,
        name,
        management: String(r.management || '').trim(),
        fundType: String(r.fund_type || '').trim(),
        market: String(r.market || '').trim(),
        status: String(r.status || '').trim(),
        listDate: String(r.list_date || '').trim(),
        foundDate: String(r.found_date || '').trim(),
      } as FundCodeMapItem;
    })
    .filter((x): x is FundCodeMapItem => Boolean(x));

const buildFromTushare = async (): Promise<FundCodeMapItem[]> => {
  const fields = [
    'ts_code',
    'symbol',
    'name',
    'management',
    'fund_type',
    'market',
    'status',
    'list_date',
    'found_date',
  ];
  const statuses = ['L', 'I', 'D'];
  const out: FundCodeMapItem[] = [];

  for (const status of statuses) {
    const rows = await callTushare('fund_basic', { status }, fields).catch(() => []);
    out.push(...mapTushareRows(rows as Record<string, unknown>[]));
  }

  return dedupeByTsCode(out);
};

const buildFromLocal = (): FundCodeMapItem[] => {
  const local = getLocalFundUniverseWithMeta();
  return dedupeByTsCode(
    local.items.map((x) => ({
      tsCode: normalize(x.tsCode),
      code: normalize(x.tsCode.split('.')[0] || ''),
      name: String(x.name || '').trim(),
      management: String(x.company || '').trim(),
      fundType: String(x.firstType || x.style || '').trim(),
      market: '',
      status: 'L',
      listDate: String(x.setupDate || '').trim(),
      foundDate: '',
    })),
  );
};

const buildFromDynamicCache = (): FundCodeMapItem[] => {
  try {
    const paths = [DYNAMIC_UNIVERSE_CACHE_PATH, STATIC_DYNAMIC_SNAPSHOT_PATH, STATIC_DYNAMIC_SRC_SNAPSHOT_PATH];

    for (const sourcePath of paths) {
      if (!fs.existsSync(sourcePath)) continue;
      const raw = fs.readFileSync(sourcePath, 'utf8');
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw) as {
        items?: Array<Record<string, unknown>>;
      };
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      if (!items.length) continue;

      const mapped = dedupeByTsCode(
        items
          .map((x) => {
            const tsCode = normalize(String(x.tsCode || x.ts_code || x.code || ''));
            const name = String(x.name || x.secName || '').trim();
            if (!tsCode || !name) return null;
            return {
              tsCode,
              code: normalize(tsCode.split('.')[0] || ''),
              name,
              management: String(x.company || x.management || x.manager || '').trim(),
              fundType: String(x.firstType || x.fundType || x.fund_type || x.style || '').trim(),
              market: String(x.market || '').trim(),
              status: String(x.status || 'L').trim(),
              listDate: String(x.listDate || x.list_date || x.setupDate || '').trim(),
              foundDate: String(x.foundDate || x.found_date || '').trim(),
            } as FundCodeMapItem;
          })
          .filter((x): x is FundCodeMapItem => Boolean(x)),
      );

      if (mapped.length) return mapped;
    }

    return [];
  } catch {
    return [];
  }
};

const buildFallbackCodeMap = (cachedItems: FundCodeMapItem[] = []) => {
  const dynamicItems = buildFromDynamicCache();
  const localItems = buildFromLocal();
  const merged = dedupeByTsCode([...cachedItems, ...dynamicItems, ...localItems]);
  const source: FundCodeMapCache['source'] = dynamicItems.length
    ? 'dynamic-cache'
    : cachedItems.length
      ? 'cache'
      : 'local';
  return { items: merged, source };
};

export const ensureFundCodeMap = async () => {
  const cached = loadCache();
  if (cached && cached.items.length > 0 && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    if (cached.items.length < 1000) {
      const dynamicSnapshot = buildFromDynamicCache();
      if (dynamicSnapshot.length > cached.items.length + 100) {
        const merged = dedupeByTsCode([...dynamicSnapshot, ...cached.items]);
        const refreshed: FundCodeMapCache = {
          updatedAt: Date.now(),
          source: 'dynamic-cache',
          items: merged,
          error: cached.error || '',
        };
        saveCache(refreshed);
        return {
          items: refreshed.items,
          updatedAt: refreshed.updatedAt,
          source: refreshed.source,
          cached: false,
          error: refreshed.error || '',
        };
      }
    }
    return {
      items: cached.items,
      updatedAt: cached.updatedAt,
      source: cached.source,
      cached: true,
      error: cached.error || '',
    };
  }

  if (hasTushareToken()) {
    try {
      const items = await buildFromTushare();
      if (!items.length) {
        throw new Error('tushare fund_basic returned empty items');
      }
      saveCache({
        updatedAt: Date.now(),
        source: 'tushare',
        items,
        error: '',
      });
      return {
        items,
        updatedAt: Date.now(),
        source: 'tushare' as const,
        cached: false,
        error: '',
      };
    } catch (err: any) {
      const fallback = buildFallbackCodeMap(cached?.items || []);
      const errorText = String(err?.message || 'tushare unavailable');
      saveCache({
        updatedAt: Date.now(),
        source: fallback.source,
        items: fallback.items,
        error: errorText,
      });
      return {
        items: fallback.items,
        updatedAt: Date.now(),
        source: fallback.source,
        cached: false,
        error: errorText,
      };
    }
  }

  if (cached?.items?.length) {
    return {
      items: cached.items,
      updatedAt: cached.updatedAt,
      source: cached.source,
      cached: true,
      error: cached.error || '',
    };
  }

  const fallback = buildFallbackCodeMap();
  saveCache({
    updatedAt: Date.now(),
    source: fallback.source,
    items: fallback.items,
    error: '',
  });
  return {
    items: fallback.items,
    updatedAt: Date.now(),
    source: fallback.source,
    cached: false,
    error: '',
  };
};

export const searchFundCodeMap = (
  items: FundCodeMapItem[],
  query: string,
  limit = 20,
) => {
  const qRaw = String(query || '').trim();
  const q = normalizeQuery(qRaw);
  if (!q) return [];

  const isCodeLike = /^\d{1,6}(\.[A-Z]{2})?$/i.test(qRaw) || /^[A-Z]{2}\d{6}$/i.test(qRaw);
  const qCode = normalize(qRaw).replace(/^(SH|SZ|OF|LOF)/, '').replace(/\.[A-Z]{2}$/, '');

  const scored = items
    .map((row) => {
      const code = normalize(row.code || row.tsCode.split('.')[0] || '');
      const tsCode = normalize(row.tsCode);
      const name = normalizeQuery(row.name);
      const mgmt = normalizeQuery(row.management);
      let score = 0;

      if (isCodeLike) {
        if (code === qCode) score += 120;
        else if (code.startsWith(qCode)) score += 80;
        if (tsCode === normalize(qRaw)) score += 120;
        else if (tsCode.startsWith(normalize(qRaw))) score += 60;
      }

      if (name === q) score += 120;
      else if (name.startsWith(q)) score += 70;
      else if (name.includes(q)) score += 45;

      if (mgmt.includes(q)) score += 15;
      if (score > 0 && String(row.status || '').toUpperCase() === 'L') score += 6;

      return { row, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.row.tsCode.localeCompare(b.row.tsCode, 'zh-CN'))
    .slice(0, Math.max(1, Math.min(50, limit)));

  return scored.map((x) => x.row);
};

export const resolveFundCodeFromText = (
  items: FundCodeMapItem[],
  text: string,
): FundCodeMapItem | null => {
  const q = String(text || '').trim();
  if (!q) return null;
  const matches = searchFundCodeMap(items, q, 1);
  return matches[0] || null;
};
