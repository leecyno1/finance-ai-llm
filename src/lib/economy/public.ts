type StooqDailyRow = {
  date: string; // YYYY-MM-DD
  close: number;
};

type CboeDailyRow = {
  date: string; // YYYY-MM-DD
  close: number;
};

type WorldBankObs = {
  date: string; // YYYY
  value: number;
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

const parseCboeDate = (mmddyyyy: string) => {
  const [mm, dd, yyyy] = mmddyyyy.split('/');
  if (!mm || !dd || !yyyy) return '';
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

export const fetchCboeVixDaily = async (opts?: {
  fromYYYYMMDD?: string;
  toYYYYMMDD?: string;
}): Promise<CboeDailyRow[]> => {
  const url =
    'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`CBOE VIX HTTP error: ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    // header: DATE,OPEN,HIGH,LOW,CLOSE
    const rows: CboeDailyRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const dateRaw = String(cols[0] ?? '').trim();
      const close = Number(cols[4]);
      const date = parseCboeDate(dateRaw);
      if (!date || Number.isNaN(close)) continue;

      // filter by [d1, d2] if provided
      const yyyymmdd = date.replace(/-/g, '');
      if (opts?.fromYYYYMMDD && yyyymmdd < opts.fromYYYYMMDD) continue;
      if (opts?.toYYYYMMDD && yyyymmdd > opts.toYYYYMMDD) continue;

      rows.push({ date, close });
    }
    return rows;
  }, 12_000);
};

export const fetchWorldBankIndicatorLatest = async (
  country: string, // e.g. USA, CHN, WLD
  indicator: string, // e.g. NY.GDP.MKTP.CD
): Promise<{ latest?: WorldBankObs; prev?: WorldBankObs }> => {
  const url = new URL(
    `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}`,
  );
  url.searchParams.set('format', 'json');
  url.searchParams.set('per_page', '80');

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`WorldBank HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const data = Array.isArray(json) ? json[1] : null;
    if (!Array.isArray(data)) return {};

    const rows: WorldBankObs[] = data
      .map((row: any) => ({
        date: String(row?.date ?? ''),
        value: typeof row?.value === 'number' ? (row.value as number) : Number.NaN,
      }))
      .filter((row: WorldBankObs) => {
        const year = Number(row.date);
        return (
          Number.isFinite(year) &&
          year > 1900 &&
          Number.isFinite(row.value)
        );
      })
      .sort((a, b) => Number(b.date) - Number(a.date));

    if (!rows.length) return {};
    return { latest: rows[0], prev: rows[1] };
  }, 12_000);
};

export const fetchWorldBankIndicatorLatestMulti = async (
  countries: string[], // e.g. ["USA","CHN","JPN","EMU","WLD"]
  indicator: string, // e.g. NY.GDP.MKTP.CD
  opts?: { fromYear?: number; toYear?: number },
): Promise<Record<string, { latest?: WorldBankObs; prev?: WorldBankObs }>> => {
  if (!countries.length) return {};

  const joined = countries.map((c) => encodeURIComponent(c)).join(';');
  const url = new URL(
    `https://api.worldbank.org/v2/country/${joined}/indicator/${encodeURIComponent(
      indicator,
    )}`,
  );
  url.searchParams.set('format', 'json');
  // When multiple countries are requested, keep only recent years to ensure all countries appear in the response.
  if (opts?.fromYear && opts?.toYear) {
    url.searchParams.set('date', `${opts.fromYear}:${opts.toYear}`);
  }
  url.searchParams.set('per_page', '200');

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`WorldBank HTTP error: ${res.status}`);
    const json = (await res.json()) as any;
    const data = Array.isArray(json) ? json[1] : null;
    if (!Array.isArray(data)) return {};

    const grouped = new Map<string, WorldBankObs[]>();
    for (const row of data) {
      const countryId = String(row?.country?.id ?? '').trim();
      const year = String(row?.date ?? '').trim();
      const value =
        typeof row?.value === 'number' ? (row.value as number) : Number.NaN;
      if (!countryId) continue;
      const y = Number(year);
      if (!Number.isFinite(y) || y <= 1900) continue;
      if (!Number.isFinite(value)) continue;
      const list = grouped.get(countryId) ?? [];
      list.push({ date: year, value });
      grouped.set(countryId, list);
    }

    const out: Record<string, { latest?: WorldBankObs; prev?: WorldBankObs }> =
      {};
    for (const [countryId, rows] of grouped.entries()) {
      rows.sort((a, b) => Number(b.date) - Number(a.date));
      if (!rows.length) continue;
      out[countryId] = { latest: rows[0], prev: rows[1] };
    }

    return out;
  }, 8_000);
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

export type SinaFuturesQuote = {
  code: string;
  name: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM:SS
  price: number;
  prev_settle?: number;
  open?: number;
  high?: number;
  low?: number;
};

export const fetchSinaFuturesQuotes = async (
  codes: string[], // e.g. ["hf_CL","hf_OIL"]
): Promise<Record<string, SinaFuturesQuote>> => {
  const cleaned = codes.map((c) => c.trim()).filter(Boolean);
  if (!cleaned.length) return {};

  const url = `https://hq.sinajs.cn/list=${cleaned.join(',')}`;

  return withTimeout(async (signal) => {
    const res = await fetch(url, {
      cache: 'no-store',
      signal,
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!res.ok) throw new Error(`Sina futures HTTP error: ${res.status}`);
    const raw = await res.arrayBuffer();
    let text = '';
    try {
      // Sina quotes are commonly encoded in GBK/GB18030.
      text = new TextDecoder('gb18030').decode(raw);
    } catch {
      text = new TextDecoder().decode(raw);
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const out: Record<string, SinaFuturesQuote> = {};
    const re = /^var\s+hq_str_([^=]+)=\"([^\"]*)\";/;

    for (const line of lines) {
      const m = line.match(re);
      if (!m) continue;
      const code = String(m[1] ?? '').trim();
      const payload = String(m[2] ?? '');
      if (!code || !payload) continue;

      const parts = payload.split(',');
      const price = Number(parts[0]);
      if (!Number.isFinite(price)) continue;

      const high = Number(parts[4]);
      const low = Number(parts[5]);
      const time = String(parts[6] ?? '').trim();
      const open = Number(parts[7]);
      const prevSettle = Number(parts[8]);
      const date = String(parts[12] ?? '').trim();
      const name = String(parts[13] ?? '').trim() || code;

      out[code] = {
        code,
        name,
        date: date || undefined,
        time: time || undefined,
        price,
        prev_settle: Number.isFinite(prevSettle) ? prevSettle : undefined,
        open: Number.isFinite(open) ? open : undefined,
        high: Number.isFinite(high) ? high : undefined,
        low: Number.isFinite(low) ? low : undefined,
      };
    }

    return out;
  }, 12_000);
};

type TreasuryYieldRow = {
  date: string; // YYYY-MM-DD
  m1?: number;
  m2?: number;
  m3?: number;
  m4?: number;
  m6?: number;
  y1?: number;
  y2?: number;
  y3?: number;
  y5?: number;
  y7?: number;
  y10?: number;
  y20?: number;
  y30?: number;
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

    const header = lines[0]
      .split(',')
      .map((h) => h.trim().replace(/^\"|\"$/g, ''));
    const norm = (h: string) => h.toLowerCase().replace(/\s+/g, ' ').trim();
    const idxDate = header.findIndex((h) => norm(h) === 'date');

    const idxByLabel = (label: string) =>
      header.findIndex((h) => norm(h) === norm(label));

    const indices = {
      m1: idxByLabel('1 mo'),
      m2: idxByLabel('2 mo'),
      m3: idxByLabel('3 mo'),
      m4: idxByLabel('4 mo'),
      m6: idxByLabel('6 mo'),
      y1: idxByLabel('1 yr'),
      y2: idxByLabel('2 yr'),
      y3: idxByLabel('3 yr'),
      y5: idxByLabel('5 yr'),
      y7: idxByLabel('7 yr'),
      y10: idxByLabel('10 yr'),
      y20: idxByLabel('20 yr'),
      y30: idxByLabel('30 yr'),
    } as const;
    if (idxDate < 0) return {};

    const parsed: TreasuryYieldRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const rawDate = cols[idxDate]?.trim();
      const date = rawDate ? parseTreasuryDate(rawDate) : '';
      if (!date) continue;
      const row: TreasuryYieldRow = { date };
      for (const [key, idx] of Object.entries(indices) as Array<
        [keyof typeof indices, number]
      >) {
        if (idx < 0) continue;
        (row as any)[key] = toNum(cols[idx] ?? '');
      }
      parsed.push(row);
    }

    parsed.sort((a, b) => a.date.localeCompare(b.date));
    // Find latest row with at least one value
    let latestIdx = -1;
    for (let i = parsed.length - 1; i >= 0; i--) {
      const hasAny = Object.entries(parsed[i]).some(
        ([k, v]) => k !== 'date' && v !== undefined,
      );
      if (hasAny) {
        latestIdx = i;
        break;
      }
    }
    if (latestIdx < 0) return {};
    const latest = parsed[latestIdx];
    let prev: TreasuryYieldRow | undefined;
    for (let i = latestIdx - 1; i >= 0; i--) {
      const hasAny = Object.entries(parsed[i]).some(
        ([k, v]) => k !== 'date' && v !== undefined,
      );
      if (hasAny) {
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
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://data.stats.gov.cn/',
    };

    const tryFetchJson = async (u: URL): Promise<any> => {
      let res = await fetch(u, {
        cache: 'no-store',
        signal,
        redirect: 'manual',
        headers,
      });

      if (res.status >= 300 && res.status < 400) {
        const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
        if (cookie) {
          res = await fetch(u, {
            cache: 'no-store',
            signal,
            redirect: 'manual',
            headers: { ...headers, Cookie: cookie },
          });
        }
      }

      if (!res.ok) throw new Error(`NBS HTTP error: ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return res.json();

      // Fallback to proxy (bypasses occasional JS/WAF pages)
      const httpUrl = u.toString().replace(/^https:\/\//, 'http://');
      const proxyUrl = `https://r.jina.ai/${httpUrl}`;
      const proxyRes = await fetch(proxyUrl, { cache: 'no-store', signal });
      if (!proxyRes.ok) throw new Error(`NBS proxy HTTP error: ${proxyRes.status}`);
      const text = await proxyRes.text();
      const marker = 'Markdown Content:';
      const idx = text.indexOf(marker);
      if (idx < 0) throw new Error('NBS proxy did not return markdown content');
      const jsonStr = text.slice(idx + marker.length).trim();
      return JSON.parse(jsonStr);
    };

    const json = await tryFetchJson(base);
    const nodes: any[] = json?.returndata?.datanodes ?? [];
    const zbMap = new Map<string, Array<{ sj: string; v: number }>>();

    const zbNodes: any[] =
      (json?.returndata?.wdnodes ?? []).find((w: any) => w?.wdcode === 'zb')
        ?.nodes ?? [];
    const unitByZb = new Map<string, string>();
    for (const n of zbNodes) {
      const code = String(n?.code ?? '').trim();
      const unit = String(n?.unit ?? '').trim();
      if (code) unitByZb.set(code, unit);
    }

    for (const n of nodes) {
      const has = n?.data?.hasdata;
      const str = String(n?.data?.strdata ?? '').trim();
      if (!has || !str) continue;
      const sj = String(
        (n?.wds ?? []).find((w: any) => w.wdcode === 'sj')?.valuecode ?? '',
      );
      const zb = String(
        (n?.wds ?? []).find((w: any) => w.wdcode === 'zb')?.valuecode ?? '',
      );
      const v = Number(str);
      if (!sj || !zb || Number.isNaN(v)) continue;
      const arr = zbMap.get(zb) ?? [];
      arr.push({ sj, v });
      zbMap.set(zb, arr);
    }

    const series =
      zbMap.get(opts.zb) ??
      (zbMap.size === 1 ? zbMap.values().next().value : undefined);

    if (!series?.length) return null;

    series.sort(
      (a, b) => sjSortKey(opts.dbcode, a.sj) - sjSortKey(opts.dbcode, b.sj),
    );
    const latest = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : undefined;

    return {
      period: parseNbsPeriod(opts.dbcode, latest.sj),
      value: latest.v,
      prev_period: prev ? parseNbsPeriod(opts.dbcode, prev.sj) : undefined,
      prev_value: prev?.v,
      unit: unitByZb.get(opts.zb),
      frequency: opts.dbcode === 'hgyd' ? '月度' : '季度',
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

export const fetchChinaBondYieldLatest = async (
  tenorYears: 3 | 5 | 10,
): Promise<MacroLatest | null> => {
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
  url.searchParams.set('gjqx', String(tenorYears));
  url.searchParams.set('qxId', 'hzsylqx');
  url.searchParams.set('locale', 'zh_CN');

  return withTimeout(async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) throw new Error(`ChinaBond HTTP error: ${res.status}`);
    const html = await res.text();

    const rows: Array<{ date: string; y: number }> = [];
    const trMatches = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];

    for (const tr of trMatches) {
      // only keep rows that look like the table data rows
      if (!tr.includes('曲线')) continue;
      const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(
        (m) => m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(),
      );
      if (tds.length < 9) continue;
      const date = tds[1];
      if (!/\d{4}-\d{2}-\d{2}/.test(date)) continue;
      const numeric = tds
        .slice(2)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => Number(v))
        .find((v) => !Number.isNaN(v));
      if (numeric === undefined) continue;
      rows.push({ date, y: numeric });
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return null;
    const latest = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : undefined;

    return {
      period: latest.date,
      value: latest.y,
      prev_period: prev?.date,
      prev_value: prev?.y,
      unit: '%',
      frequency: '日度',
    };
  }, 12_000);
};

export const fetchChinaBond10yLatest = async (): Promise<MacroLatest | null> =>
  fetchChinaBondYieldLatest(10);

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
