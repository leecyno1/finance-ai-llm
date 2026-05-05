import { callTushare, hasTushareToken } from '@/lib/economy/tushare';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ResearchDataPack = {
  query: string;
  security?: {
    tsCode?: string;
    name?: string;
    market?: string;
    industry?: string;
    listDate?: string;
  };
  latestDailyBasic?: Record<string, unknown> | null;
  financialIndicators?: Record<string, unknown>[];
  income?: Record<string, unknown>[];
  balanceSheet?: Record<string, unknown>[];
  cashflow?: Record<string, unknown>[];
  akshare?: Record<string, unknown> | null;
  sources: string[];
  warnings: string[];
};

const KNOWN_SECURITY_ALIASES: Record<string, string> = {
  中际旭创: '300308.SZ',
};

const RESEARCH_FIELDS = {
  stockBasic: ['ts_code', 'name', 'market', 'industry', 'list_date'],
  dailyBasic: [
    'ts_code',
    'trade_date',
    'close',
    'pe',
    'pe_ttm',
    'pb',
    'ps_ttm',
    'total_mv',
    'circ_mv',
    'turnover_rate',
  ],
  finaIndicator: [
    'ts_code',
    'ann_date',
    'end_date',
    'roe',
    'grossprofit_margin',
    'netprofit_margin',
    'debt_to_assets',
    'or_yoy',
    'netprofit_yoy',
  ],
  income: ['ts_code', 'ann_date', 'end_date', 'revenue', 'operate_profit', 'n_income_attr_p'],
  balancesheet: ['ts_code', 'ann_date', 'end_date', 'total_assets', 'total_liab', 'total_hldr_eqy_exc_min_int'],
  cashflow: ['ts_code', 'ann_date', 'end_date', 'n_cashflow_act', 'c_cash_equ_end_period'],
};

const extractTsCode = (query: string) => {
  const direct = query.match(/\b\d{6}\.(?:SZ|SH|BJ)\b/i)?.[0];
  if (direct) return direct.toUpperCase();

  const plain = query.match(/\b(\d{6})\b/)?.[1];
  if (plain) {
    if (/^30|^00/.test(plain)) return `${plain}.SZ`;
    if (/^60|^68/.test(plain)) return `${plain}.SH`;
    if (/^8|^4/.test(plain)) return `${plain}.BJ`;
  }

  for (const [alias, tsCode] of Object.entries(KNOWN_SECURITY_ALIASES)) {
    if (query.includes(alias)) return tsCode;
  }

  return undefined;
};

const compactRows = (rows: Record<string, unknown>[], limit = 4) =>
  rows
    .filter(Boolean)
    .slice(0, limit)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== ''),
      ),
    );

const safeTushare = async (
  apiName: string,
  params: Record<string, unknown>,
  fields: string[],
  warnings: string[],
) => {
  try {
    return (await callTushare(apiName, params, fields)) as Record<string, unknown>[];
  } catch (err: any) {
    warnings.push(`${apiName}: ${err?.message || String(err)}`);
    return [];
  }
};

const fetchAksharePack = async (
  query: string,
  tsCode: string | undefined,
  warnings: string[],
) => {
  const scriptPath = path.join(process.cwd(), 'scripts/akshare_research_pack.py');
  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, query, tsCode || ''], {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 2,
    });
    const parsed = JSON.parse(stdout || '{}') as Record<string, any>;
    if (Array.isArray(parsed.warnings)) warnings.push(...parsed.warnings.map(String));
    return parsed;
  } catch (err: any) {
    warnings.push(`akshare: ${err?.message || String(err)}`);
    return null;
  }
};

export const buildResearchDataPack = async (query: string): Promise<ResearchDataPack> => {
  const warnings: string[] = [];
  const sources: string[] = [];
  const tsCode = extractTsCode(query);

  if (!hasTushareToken()) {
    warnings.push('TuShare token not configured; structured financial data unavailable.');
    const akshare = await fetchAksharePack(query, tsCode, warnings);
    if (akshare && Array.isArray(akshare.sources)) {
      sources.push(...akshare.sources.map(String));
    }
    return {
      query,
      security: tsCode ? { tsCode } : undefined,
      latestDailyBasic: null,
      financialIndicators: [],
      income: [],
      balanceSheet: [],
      cashflow: [],
      akshare,
      sources,
      warnings,
    };
  }

  if (!tsCode) {
    warnings.push('未能从问题中识别证券代码；仅可基于检索来源进行定性分析。');
  }

  const securityRows = tsCode
    ? await safeTushare('stock_basic', { ts_code: tsCode }, RESEARCH_FIELDS.stockBasic, warnings)
    : [];
  if (securityRows.length) sources.push('TuShare.stock_basic');

  const [dailyRows, finaRows, incomeRows, balanceRows, cashflowRows] = tsCode
    ? await Promise.all([
        safeTushare('daily_basic', { ts_code: tsCode }, RESEARCH_FIELDS.dailyBasic, warnings),
        safeTushare('fina_indicator', { ts_code: tsCode }, RESEARCH_FIELDS.finaIndicator, warnings),
        safeTushare('income', { ts_code: tsCode }, RESEARCH_FIELDS.income, warnings),
        safeTushare('balancesheet', { ts_code: tsCode }, RESEARCH_FIELDS.balancesheet, warnings),
        safeTushare('cashflow', { ts_code: tsCode }, RESEARCH_FIELDS.cashflow, warnings),
      ])
    : [[], [], [], [], []];

  const akshare = await fetchAksharePack(query, tsCode, warnings);
  if (akshare && Array.isArray(akshare.sources)) {
    sources.push(...akshare.sources.map(String));
  }

  if (dailyRows.length) sources.push('TuShare.daily_basic');
  if (finaRows.length) sources.push('TuShare.fina_indicator');
  if (incomeRows.length) sources.push('TuShare.income');
  if (balanceRows.length) sources.push('TuShare.balancesheet');
  if (cashflowRows.length) sources.push('TuShare.cashflow');

  const security = securityRows[0]
    ? {
        tsCode: String(securityRows[0].ts_code || tsCode || ''),
        name: String(securityRows[0].name || ''),
        market: String(securityRows[0].market || ''),
        industry: String(securityRows[0].industry || ''),
        listDate: String(securityRows[0].list_date || ''),
      }
    : tsCode
      ? { tsCode }
      : undefined;

  return {
    query,
    security,
    latestDailyBasic: compactRows(dailyRows, 1)[0] || null,
    financialIndicators: compactRows(finaRows),
    income: compactRows(incomeRows),
    balanceSheet: compactRows(balanceRows),
    cashflow: compactRows(cashflowRows),
    akshare,
    sources,
    warnings,
  };
};
