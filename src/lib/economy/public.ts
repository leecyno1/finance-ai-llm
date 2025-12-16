type StooqDailyRow = {
  date: string; // YYYY-MM-DD
  close: number;
};

type TencentDailyRow = {
  date: string; // YYYY-MM-DD
  close: number;
  pct_chg: number;
};

const withTimeout = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchStooqDaily = async (
  symbol: string,
  opts?: { fromYYYYMMDD?: string; toYYYYMMDD?: string },
): Promise<StooqDailyRow[]> => {
  const url = new URL('https://stooq.com/q/d/l/');
  url.searchParams.set('s', symbol);
  url.searchParams.set('i', 'd');
  if (opts?.fromYYYYMMDD) url.searchParams.set('d1', opts.fromYYYYMMDD);
  if (opts?.toYYYYMMDD) url.searchParams.set('d2', opts.toYYYYMMDD);

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`Stooq HTTP error: ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || lines[0].toLowerCase().includes('no data')) return [];
    // header: Date,Open,High,Low,Close,Volume
    const rows: StooqDailyRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const date = cols[0];
      const close = Number(cols[4]);
      if (!date || Number.isNaN(close)) continue;
      rows.push({ date, close });
    }
    return rows;
  }, 12_000);
};

export const fetchTencentKlineDaily = async (
  code: string, // e.g. sh000001
  days: number,
): Promise<TencentDailyRow[]> => {
  const url = new URL('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.searchParams.set('param', `${code},day,,,${Math.max(10, days)},qfq`);

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`Tencent kline HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const arr: any[] = json?.data?.[code]?.day ?? [];
    const rows: TencentDailyRow[] = [];
    for (const item of arr) {
      // [date, open, close, high, low, volume]
      const date = String(item?.[0] ?? '');
      const close = Number(item?.[2]);
      if (!date || Number.isNaN(close)) continue;
      rows.push({ date, close, pct_chg: 0 });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < rows.length; i++) {
      const prev = i > 0 ? rows[i - 1].close : rows[i].close;
      rows[i].pct_chg = prev ? ((rows[i].close - prev) / prev) * 100 : 0;
    }
    return rows;
  }, 12_000);
};

type TreasuryYieldRow = {
  date: string; // YYYY-MM-DD
  y2?: number;
  y10?: number;
};

const parseTreasuryDate = (mmddyyyy: string) => {
  const [mm, dd, yyyy] = mmddyyyy.split('/');
  if (!mm || !dd || !yyyy) return '';
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

const toNum = (v: string) => {
  const trimmed = v.trim();
  if (!trimmed || trimmed.toUpperCase() === 'N/A') return undefined;
  const n = Number(trimmed);
  return Number.isNaN(n) ? undefined : n;
};

export const fetchTreasuryYieldCurveLatest = async (): Promise<{
  latest?: TreasuryYieldRow;
  prev?: TreasuryYieldRow;
}> => {
  const year = new Date().getFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&page&_format=csv`;

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`Treasury HTTP error: ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return {};

    const header = lines[0].split(',').map((h) => h.trim());
    const idxDate = header.findIndex((h) => h.toLowerCase() === 'date');
    const idx2 = header.findIndex((h) => h.toLowerCase() === '2 yr');
    const idx10 = header.findIndex((h) => h.toLowerCase() === '10 yr');
    if (idxDate < 0) return {};

    const parsed: TreasuryYieldRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const rawDate = cols[idxDate]?.trim();
      const date = rawDate ? parseTreasuryDate(rawDate) : '';
      if (!date) continue;
      const y2 = idx2 >= 0 ? toNum(cols[idx2] ?? '') : undefined;
      const y10 = idx10 >= 0 ? toNum(cols[idx10] ?? '') : undefined;
      parsed.push({ date, y2, y10 });
    }

    parsed.sort((a, b) => a.date.localeCompare(b.date));
    // Find latest row with at least one value
    let latestIdx = -1;
    for (let i = parsed.length - 1; i >= 0; i--) {
      if (parsed[i].y2 !== undefined || parsed[i].y10 !== undefined) {
        latestIdx = i;
        break;
      }
    }
    if (latestIdx < 0) return {};
    const latest = parsed[latestIdx];
    let prev: TreasuryYieldRow | undefined;
    for (let i = latestIdx - 1; i >= 0; i--) {
      if (parsed[i].y2 !== undefined || parsed[i].y10 !== undefined) {
        prev = parsed[i];
        break;
      }
    }
    return { latest, prev };
  }, 12_000);
};

export type MacroLatest = {
  period: string;
  value: number;
  prev_period?: string;
  prev_value?: number;
  unit?: string;
  frequency?: string;
};

const parseNbsPeriod = (dbcode: string, sj: string) => {
  if (dbcode === 'hgyd' && /^\d{6}$/.test(sj)) {
    return `${sj.slice(0, 4)}-${sj.slice(4, 6)}`;
  }
  if (dbcode === 'hgjd' && /^\d{4}[A-D]$/.test(sj)) {
    const year = sj.slice(0, 4);
    const q = sj.slice(4);
    const qMap: Record<string, string> = { A: 'Q1', B: 'Q2', C: 'Q3', D: 'Q4' };
    return `${year}-${qMap[q] ?? q}`;
  }
  return sj;
};

const sjSortKey = (dbcode: string, sj: string) => {
  if (dbcode === 'hgyd' && /^\d{6}$/.test(sj)) return Number(sj);
  if (dbcode === 'hgjd' && /^\d{4}[A-D]$/.test(sj)) {
    const year = Number(sj.slice(0, 4));
    const qMap: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };
    return year * 10 + (qMap[sj.slice(4)] ?? 0);
  }
  return 0;
};

export const fetchNbsLatest = async (opts: {
  dbcode: 'hgyd' | 'hgjd';
  cn: string;
  zb: string;
}): Promise<MacroLatest | null> => {
  const base = new URL('https://data.stats.gov.cn/easyquery.htm');
  base.searchParams.set('m', 'QueryData');
  base.searchParams.set('dbcode', opts.dbcode);
  base.searchParams.set('rowcode', 'sj');
  base.searchParams.set('colcode', 'zb');
  base.searchParams.set('wds', '[]');
  base.searchParams.set(
    'dfwds',
    JSON.stringify([{ wdcode: 'zb', valuecode: opts.zb }]),
  );

  return withTimeout(async (signal) => {
    const res = await fetch(base, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`NBS HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const nodes: any[] = json?.returndata?.datanodes ?? [];
    const points: Array<{ sj: string; v: number }> = [];
    for (const n of nodes) {
      const has = n?.data?.hasdata;
      const str = String(n?.data?.strdata ?? '').trim();
      if (!has || !str) continue;
      const sj = String((n?.wds ?? []).find((w: any) => w.wdcode === 'sj')?.valuecode ?? '');
      const v = Number(str);
      if (!sj || Number.isNaN(v)) continue;
      points.push({ sj, v });
    }

    if (!points.length) return null;
    points.sort((a, b) => sjSortKey(opts.dbcode, a.sj) - sjSortKey(opts.dbcode, b.sj));
    const latest = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : undefined;

    return {
      period: parseNbsPeriod(opts.dbcode, latest.sj),
      value: latest.v,
      prev_period: prev ? parseNbsPeriod(opts.dbcode, prev.sj) : undefined,
      prev_value: prev?.v,
    };
  }, 12_000);
};

export const fetchShiborLatest = async (): Promise<{
  showDateCN?: string;
  records: Array<{ term: string; value: number; deltaBp?: number }>;
} | null> => {
  const url = 'https://www.shibor.org/r/cms/www/chinamoney/data/shibor/shibor.json';
  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`SHIBOR HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const showDateCN = String(json?.data?.showDateCN ?? '');
    const records: any[] = json?.records ?? [];
    const mapped = records
      .map((r) => {
        const term = String(r?.termCode ?? '').trim();
        const value = Number(r?.shibor);
        const deltaBp = typeof r?.shibIdUpDownNum === 'number' ? r.shibIdUpDownNum : undefined;
        if (!term || Number.isNaN(value)) return null;
        return { term, value, deltaBp };
      })
      .filter(Boolean) as Array<{ term: string; value: number; deltaBp?: number }>;

    return { showDateCN, records: mapped };
  }, 12_000);
};

export const fetchLprLatest = async (): Promise<{
  showDateCN?: string;
  records: Array<{ term: string; value: number }>;
} | null> => {
  const url = 'https://www.shibor.org/r/cms/www/chinamoney/data/currency/bk-lpr.json';
  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal, method: 'POST' });
    if (!res.ok) throw new Error(`LPR HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const showDateCN = String(json?.data?.showDateCN ?? '');
    const records: any[] = json?.records ?? [];
    const mapped = records
      .map((r) => {
        const term = String(r?.termCode ?? '').trim();
        const value = Number(r?.shibor);
        if (!term || Number.isNaN(value)) return null;
        return { term, value };
      })
      .filter(Boolean) as Array<{ term: string; value: number }>;
    return { showDateCN, records: mapped };
  }, 12_000);
};

export const fetchChinaBond10yLatest = async (): Promise<MacroLatest | null> => {
  const now = new Date();
  const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const start = new Date(now);
  start.setDate(start.getDate() - 45);
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
    start.getDate(),
  ).padStart(2, '0')}`;

  const url = new URL('https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery');
  url.searchParams.set('startDate', startStr);
  url.searchParams.set('endDate', end);
  url.searchParams.set('gjqx', '10');
  url.searchParams.set('qxId', 'hzsylqx');
  url.searchParams.set('locale', 'zh_CN');

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`ChinaBond HTTP error: ${res.status}`);
    const html = await res.text();

    const rows: Array<{ date: string; y10: number }> = [];
    const trMatches = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];

    for (const tr of trMatches) {
      // only keep rows that look like the table data rows
      if (!tr.includes('Yield Curve') && !tr.includes('曲线')) continue;
      const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(
        (m) => m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(),
      );
      if (tds.length < 9) continue;
      const date = tds[1];
      const y10 = Number(tds[8]);
      if (!/\\d{4}-\\d{2}-\\d{2}/.test(date) || Number.isNaN(y10)) continue;
      rows.push({ date, y10 });
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    const latest = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : undefined;

    return {
      period: latest.date,
      value: latest.y10,
      prev_period: prev?.date,
      prev_value: prev?.y10,
      unit: '%',
      frequency: '日度',
    };
  }, 12_000);
};

export const fetchErApiUsdLatest = async (): Promise<Record<string, number> | null> => {
  const url = 'https://open.er-api.com/v6/latest/USD';
  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`ER-API HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const rates = json?.rates;
    if (!rates || typeof rates !== 'object') return null;
    return rates as Record<string, number>;
  }, 12_000);
};

export const fetchFredLatest = async (seriesId: string): Promise<MacroLatest | null> => {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(
    seriesId,
  )}`;

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`FRED HTTP error: ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const rows: Array<{ date: string; v: number }> = [];
    for (let i = 1; i < lines.length; i++) {
      const [date, value] = lines[i].split(',');
      if (!date || !value) continue;
      if (value.trim() === '.' || value.trim().toUpperCase() === 'N/A') continue;
      const v = Number(value);
      if (Number.isNaN(v)) continue;
      rows.push({ date: date.trim(), v });
    }
    if (!rows.length) return null;
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const latest = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : undefined;
    return {
      period: latest.date,
      value: latest.v,
      prev_period: prev?.date,
      prev_value: prev?.v,
    };
  }, 12_000);
};
