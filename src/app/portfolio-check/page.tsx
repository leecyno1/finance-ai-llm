'use client';

import { useMemo, useRef, useState } from 'react';
import Markdown from 'markdown-to-jsx';
import { useClientLanguage } from '@/lib/hooks/useClientLanguage';

type HoldingRow = {
  symbol: string;
  weight: number;
  normalizedWeight: number;
  profile: {
    name: string;
    assetClass: string;
    region: string;
    sector: string;
  };
};

type PortfolioCheckResult = {
  parsedHoldings: HoldingRow[];
  exposure: {
    byAssetClass: Record<string, number>;
    byRegion: Record<string, number>;
    bySector: Record<string, number>;
    factorExposure: Record<string, number>;
  };
  topFactorSensitivities: Array<{ factor: string; value: number; interpretation: string }>;
  rebalanceSuggestions: string[];
  riskScore: number;
};

type ApiSection = {
  id: 'diagnosis' | 'tushare' | 'agent';
  title: string;
  markdown: string;
};

type FundMapSuggestion = {
  tsCode: string;
  code: string;
  name: string;
  management: string;
  fundType: string;
  status: string;
};

type InputRow = {
  id: string;
  nameOrCode: string;
  weight: string;
  resolvedTsCode?: string;
  resolvedName?: string;
};

type ApiResponse = {
  ok: boolean;
  result: PortfolioCheckResult | null;
  markdown: string;
  sections?: ApiSection[];
  agentMeta?: {
    mode?: 'llm' | 'fallback';
    providerId?: string;
    model?: string;
    error?: string;
    sourceCount?: number;
  } | null;
  fundMapMeta?: {
    total?: number;
    source?: string;
    updatedAt?: number;
    cached?: boolean;
    error?: string;
  } | null;
};

const SAMPLE_A: InputRow[] = [
  { id: 'a1', nameOrCode: '510300', weight: '30' },
  { id: 'a2', nameOrCode: '159919', weight: '25' },
  { id: 'a3', nameOrCode: '518880', weight: '15' },
  { id: 'a4', nameOrCode: '511010', weight: '20' },
  { id: 'a5', nameOrCode: '512480', weight: '10' },
];

const SAMPLE_B: InputRow[] = [
  { id: 'b1', nameOrCode: '000001', weight: '35' },
  { id: 'b2', nameOrCode: '510050', weight: '20' },
  { id: 'b3', nameOrCode: '512480', weight: '20' },
  { id: 'b4', nameOrCode: '511010', weight: '15' },
  { id: 'b5', nameOrCode: '518880', weight: '10' },
];

const cardTone =
  'rounded-2xl border border-light-200 dark:border-dark-200 bg-gradient-to-br from-light-secondary/80 to-light-primary/60 dark:from-dark-secondary/80 dark:to-dark-primary/60';

const parseWeight = (raw: string) => {
  const cleaned = String(raw || '').replace(/[%，\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

const normalizeCodeInput = (value: string) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const extractCandidateSymbol = (row: InputRow) => {
  if (row.resolvedTsCode) return row.resolvedTsCode;

  const raw = normalizeCodeInput(row.nameOrCode);
  if (!raw) return '';
  const tsCodeMatch = raw.match(/\d{6}\.(SH|SZ|BJ|OF)/);
  if (tsCodeMatch) return tsCodeMatch[0];
  const bracketTsCode = raw.match(/\((\d{6}\.(SH|SZ|BJ|OF))\)/);
  if (bracketTsCode?.[1]) return bracketTsCode[1];
  return raw;
};

const makeRows = (base?: InputRow[]) =>
  (base && base.length ? base : [{ id: 'r1', nameOrCode: '', weight: '' }]).map((x, idx) => ({
    ...x,
    id: x.id || `r${idx + 1}`,
  }));

const PortfolioCheckPage = () => {
  const language = useClientLanguage('zh');
  const [rows, setRows] = useState<InputRow[]>(makeRows(SAMPLE_A));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioCheckResult | null>(null);
  const [sections, setSections] = useState<ApiSection[]>([]);
  const [agentMeta, setAgentMeta] = useState<ApiResponse['agentMeta']>(null);
  const [fundMapMeta, setFundMapMeta] = useState<ApiResponse['fundMapMeta']>(null);
  const [activeRowId, setActiveRowId] = useState('');
  const [suggestions, setSuggestions] = useState<FundMapSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const suggestTimerRef = useRef<number | null>(null);
  const suggestReqRef = useRef(0);

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  const applySample = (sample: InputRow[]) => {
    setRows(makeRows(sample));
    setSuggestions([]);
    setActiveRowId('');
  };

  const setRowValue = (rowId: string, patch: Partial<InputRow>) => {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };

  const requestSuggestions = (rowId: string, query: string) => {
    const q = String(query || '').trim();
    if (!q) {
      setSuggestions([]);
      return;
    }

    if (suggestTimerRef.current) window.clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = window.setTimeout(async () => {
      const reqId = ++suggestReqRef.current;
      try {
        setSuggestLoading(true);
        const url = `/api/finance/fund-map?q=${encodeURIComponent(q)}&limit=12`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (reqId !== suggestReqRef.current) return;
        if (res.ok && data?.ok && Array.isArray(data?.items)) {
          setSuggestions(data.items);
          setActiveRowId(rowId);
        } else {
          setSuggestions([]);
        }
      } catch {
        if (reqId === suggestReqRef.current) setSuggestions([]);
      } finally {
        if (reqId === suggestReqRef.current) setSuggestLoading(false);
      }
    }, 180);
  };

  const addRow = () => {
    const id = `r${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setRows((prev) => [...prev, { id, nameOrCode: '', weight: '' }]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((x) => x.id !== rowId);
      return next.length ? next : [{ id: `r${Date.now()}`, nameOrCode: '', weight: '' }];
    });
    if (activeRowId === rowId) {
      setActiveRowId('');
      setSuggestions([]);
    }
  };

  const selectSuggestion = (rowId: string, item: FundMapSuggestion) => {
    setRowValue(rowId, {
      nameOrCode: `${item.name} (${item.tsCode})`,
      resolvedTsCode: item.tsCode,
      resolvedName: item.name,
    });
    setSuggestions([]);
    setActiveRowId('');
  };

  const runCheck = async () => {
    const holdings = rows
      .map((row) => ({
        symbol: extractCandidateSymbol(row),
        name: row.resolvedName || row.nameOrCode,
        weight: parseWeight(row.weight),
      }))
      .filter((x) => x.symbol && Number.isFinite(x.weight) && x.weight > 0);

    if (!holdings.length) {
      setResult(null);
      setSections([]);
      return;
    }

    const input = holdings.map((x) => `${x.symbol} ${x.weight}`).join('\n');

    setLoading(true);
    try {
      const res = await fetch('/api/finance/portfolio-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, holdings }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) throw new Error('Failed to run check');

      setResult(data.result);
      setSections(Array.isArray(data.sections) ? data.sections : []);
      setAgentMeta(data.agentMeta || null);
      setFundMapMeta(data.fundMapMeta || null);
    } catch (err) {
      console.error('Failed to run fund diagnostics', err);
      setResult(null);
      setSections([]);
      setAgentMeta(null);
    } finally {
      setLoading(false);
    }
  };

  const topSector = useMemo(() => {
    if (!result) return null;
    const rowsBySector = Object.entries(result.exposure.bySector).sort((a, b) => b[1] - a[1]);
    return rowsBySector[0] || null;
  }, [result]);

  const topRegion = useMemo(() => {
    if (!result) return null;
    const rowsByRegion = Object.entries(result.exposure.byRegion).sort((a, b) => b[1] - a[1]);
    return rowsByRegion[0] || null;
  }, [result]);

  const mappedCount = useMemo(
    () => rows.filter((x) => x.resolvedTsCode || /^\d{6}\.(SH|SZ|BJ|OF)$/i.test(extractCandidateSymbol(x))).length,
    [rows],
  );

  return (
    <div className="pt-6 pb-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-black/90 dark:text-white/90">
          {t('Fund Diagnostics', '基金诊断')}
        </h1>
        <p className="text-[11px] text-black/55 dark:text-white/55 mt-1">
          {t(
            'Fill holdings in table form (name/code + weight), with TuShare fund code-name auto-complete.',
            '以表格填报持仓（名称/代码 + 配置比例），并使用 TuShare 基金映射自动补全。',
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[460px_1fr] gap-4">
        <div className={`${cardTone} p-3`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-black/75 dark:text-white/80">
              {t('Holdings Input Table', '持仓输入表格')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => applySample(SAMPLE_A)}
                className="text-[11px] px-2 py-1 rounded-lg border border-light-200 dark:border-dark-200"
              >
                CN A
              </button>
              <button
                type="button"
                onClick={() => applySample(SAMPLE_B)}
                className="text-[11px] px-2 py-1 rounded-lg border border-light-200 dark:border-dark-200"
              >
                CN B
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-light-200/70 dark:border-dark-200/70 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-light-primary/70 dark:bg-dark-primary/60">
                <tr className="text-black/55 dark:text-white/55">
                  <th className="text-left py-2 px-2">{t('Name / Code', '名称/代码')}</th>
                  <th className="text-left py-2 px-2 w-[120px]">{t('Weight %', '配置比例%')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-light-200/45 dark:divide-dark-200/45">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2 py-1.5 align-top">
                      <div className="flex items-start gap-1">
                        <div className="relative flex-1">
                          <input
                            value={row.nameOrCode}
                            onFocus={() => setActiveRowId(row.id)}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setActiveRowId((prev) => (prev === row.id ? '' : prev));
                                setSuggestions([]);
                              }, 120);
                            }}
                            onChange={(e) => {
                              const value = e.target.value;
                              setRowValue(row.id, {
                                nameOrCode: value,
                                resolvedTsCode: undefined,
                                resolvedName: undefined,
                              });
                              requestSuggestions(row.id, value);
                            }}
                            className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary/65 dark:bg-dark-primary/45 px-2 py-1.5 text-xs text-black/85 dark:text-white/85 focus:outline-none"
                            placeholder={t('e.g. 000001 / 南方中证500ETF', '例如 000001 / 南方中证500ETF')}
                          />
                          {activeRowId === row.id && suggestions.length > 0 ? (
                            <div className="absolute z-20 mt-1 w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary max-h-52 overflow-y-auto shadow-lg">
                              {suggestions.map((item) => (
                                <button
                                  key={`${row.id}-${item.tsCode}`}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectSuggestion(row.id, item);
                                  }}
                                  className="w-full text-left px-2 py-1.5 hover:bg-light-200/60 dark:hover:bg-dark-200/60"
                                >
                                  <div className="text-[11px] text-black/85 dark:text-white/85">
                                    {item.name} ({item.tsCode})
                                  </div>
                                  <div className="text-[10px] text-black/50 dark:text-white/55">
                                    {item.management || '-'} · {item.fundType || '-'}
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="text-[11px] px-1.5 py-1 rounded border border-light-200 dark:border-dark-200 mt-0.5"
                        >
                          -
                        </button>
                      </div>
                      {row.resolvedTsCode ? (
                        <div className="mt-1 text-[10px] text-cyan-700 dark:text-cyan-300">
                          {t('Mapped', '已映射')}: {row.resolvedTsCode}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.weight}
                        onChange={(e) => setRowValue(row.id, { weight: e.target.value })}
                        className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary/65 dark:bg-dark-primary/45 px-2 py-1.5 text-xs text-black/85 dark:text-white/85 focus:outline-none"
                        placeholder="30"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3">
            <div className="text-[11px] text-black/45 dark:text-white/45">
              {t('Rows', '行数')}: {rows.length} · {t('Mapped', '可识别')}: {mappedCount}
              {suggestLoading ? ` · ${t('Searching...', '检索中...')}` : ''}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addRow}
                className="text-[11px] px-2 py-1 rounded-lg border border-light-200 dark:border-dark-200"
              >
                {t('Add Row', '新增行')}
              </button>
              <button
                type="button"
                onClick={runCheck}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 !text-xs text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/25 transition disabled:opacity-60"
              >
                {loading ? t('Diagnosing...', '诊断中...') : t('Run Diagnostics', '开始诊断')}
              </button>
            </div>
          </div>

          {fundMapMeta?.total ? (
            <div className="mt-2 text-[10px] text-black/45 dark:text-white/50">
              TuShare {t('fund map', '基金映射库')}: {fundMapMeta.total} ·{' '}
              {t('source', '来源')}: {fundMapMeta.source || '-'} ·{' '}
              {fundMapMeta.cached ? t('cache hit', '缓存命中') : t('fresh', '实时')}
            </div>
          ) : null}
        </div>

        <div className={`${cardTone} p-3`}>
          {!result ? (
            <div className="h-full min-h-[380px] flex items-center justify-center text-sm text-black/55 dark:text-white/55">
              {t('No report yet.', '暂无诊断报告。')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60 border border-light-200/50 dark:border-dark-200/50">
                  <div className="text-black/50 dark:text-white/50">{t('Risk Score', '风险评分')}</div>
                  <div className="text-black/85 dark:text-white/90 font-semibold mt-1">
                    {result.riskScore.toFixed(1)} / 100
                  </div>
                </div>
                <div className="rounded-xl px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60 border border-light-200/50 dark:border-dark-200/50">
                  <div className="text-black/50 dark:text-white/50">{t('Top Region', '区域集中')}</div>
                  <div className="text-black/85 dark:text-white/90 font-semibold mt-1">
                    {topRegion ? `${topRegion[0]} ${topRegion[1].toFixed(1)}%` : '-'}
                  </div>
                </div>
                <div className="rounded-xl px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60 border border-light-200/50 dark:border-dark-200/50">
                  <div className="text-black/50 dark:text-white/50">{t('Top Sector', '行业集中')}</div>
                  <div className="text-black/85 dark:text-white/90 font-semibold mt-1">
                    {topSector ? `${topSector[0]} ${topSector[1].toFixed(1)}%` : '-'}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 p-2">
                <div className="text-[11px] font-semibold text-black/75 dark:text-white/80 mb-1">
                  {t('Rebalance Suggestions', '再平衡建议')}
                </div>
                <ul className="text-xs text-black/70 dark:text-white/75 space-y-1 list-disc pl-5">
                  {result.rebalanceSuggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 p-2 overflow-x-auto">
                <div className="text-[11px] font-semibold text-black/75 dark:text-white/80 mb-1">
                  {t('Top Factor Sensitivities', '主要敏感因子')}
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-black/50 dark:text-white/50">
                      <th className="text-left py-1 pr-2">{t('Factor', '因子')}</th>
                      <th className="text-right py-1 pr-2">{t('Value', '暴露值')}</th>
                      <th className="text-left py-1">{t('Interpretation', '解读')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.topFactorSensitivities.map((f) => (
                      <tr key={f.factor}>
                        <td className="py-1 pr-2">{f.factor}</td>
                        <td className="py-1 pr-2 text-right font-semibold">{f.value.toFixed(3)}</td>
                        <td className="py-1">{f.interpretation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {agentMeta?.providerId || agentMeta?.model ? (
                <div className="text-[11px] text-right">
                  <span className="text-black/50 dark:text-white/50">
                    Agent: {agentMeta?.providerId || '-'} / {agentMeta?.model || '-'}
                  </span>
                  {agentMeta?.mode === 'fallback' ? (
                    <span className="ml-2 inline-flex rounded-full border border-amber-400/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      {t('Fallback', '回退模式')}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="mt-4 space-y-3">
          {sections.map((section) => (
            <section key={section.id} className={`${cardTone} p-3`}>
              <h2 className="text-sm font-semibold text-black/85 dark:text-white/90 mb-2">
                {section.title}
              </h2>
              <Markdown
                className="prose dark:prose-invert max-w-none text-sm prose-headings:mt-4 prose-headings:mb-2 prose-table:text-xs prose-th:text-[11px] prose-td:text-[11px]"
              >
                {section.markdown}
              </Markdown>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default PortfolioCheckPage;
