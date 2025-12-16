type StooqDailyRow = {
  date: string; // YYYY-MM-DD
  close: number;
};

type TencentDailyRow = {
  date: string; // YYYY-MM-DD
  close: number;
  pct_chg: number;
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
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
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchTencentKlineDaily = async (
  code: string, // e.g. sh000001
  days: number,
): Promise<TencentDailyRow[]> => {
  const url = new URL('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get');
  url.searchParams.set('param', `${code},day,,,${Math.max(10, days)},qfq`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
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
  } finally {
    clearTimeout(timeout);
  }
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
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
  } finally {
    clearTimeout(timeout);
  }
};

