'use client';

import { useEffect, useMemo, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';

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

type ApiResponse = {
  ok: boolean;
  result: PortfolioCheckResult | null;
  markdown: string;
};

const SAMPLE_1 = `AAPL 25\nMSFT 20\nTLT 20\nGLD 10\nCSI300 25`;
const SAMPLE_2 = `QQQ 35\nSPY 25\nTLT 15\nVNQ 10\nCASH 15`;

const PortfolioCheckPage = () => {
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );
  const [input, setInput] = useState(SAMPLE_1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioCheckResult | null>(null);
  const [markdown, setMarkdown] = useState('');

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  useEffect(() => {
    const updateLanguage = () => {
      setLanguage(
        ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh') as 'en' | 'zh',
      );
    };

    window.addEventListener('client-config-changed', updateLanguage);
    window.addEventListener('storage', updateLanguage);

    return () => {
      window.removeEventListener('client-config-changed', updateLanguage);
      window.removeEventListener('storage', updateLanguage);
    };
  }, []);

  const runCheck = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/finance/portfolio-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) throw new Error('Failed to run check');

      setResult(data.result);
      setMarkdown(data.markdown || '');
    } catch (err) {
      console.error('Failed to run portfolio check', err);
      setResult(null);
      setMarkdown('');
    } finally {
      setLoading(false);
    }
  };

  const topSector = useMemo(() => {
    if (!result) return null;
    const rows = Object.entries(result.exposure.bySector).sort((a, b) => b[1] - a[1]);
    return rows[0] || null;
  }, [result]);

  const topRegion = useMemo(() => {
    if (!result) return null;
    const rows = Object.entries(result.exposure.byRegion).sort((a, b) => b[1] - a[1]);
    return rows[0] || null;
  }, [result]);

  return (
    <div className="pt-6 pb-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-black/85 dark:text-white/85">
          {t('Portfolio Health Check', '组合体检模式')}
        </h1>
        <p className="text-[11px] text-black/50 dark:text-white/50 mt-1">
          {t(
            'Input holdings to get exposure, factor sensitivity, and rebalance suggestions.',
            '输入持仓后自动输出暴露、敏感因子与再平衡建议。',
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-black/70 dark:text-white/70">
              {t('Holdings Input', '持仓输入')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setInput(SAMPLE_1)}
                className="text-[11px] px-2 py-1 rounded-lg border border-light-200 dark:border-dark-200"
              >
                Sample A
              </button>
              <button
                type="button"
                onClick={() => setInput(SAMPLE_2)}
                className="text-[11px] px-2 py-1 rounded-lg border border-light-200 dark:border-dark-200"
              >
                Sample B
              </button>
            </div>
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full min-h-[240px] rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/40 px-3 py-2 text-xs text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none"
            placeholder={t(
              'One holding per line, e.g.\nAAPL 30\nTLT 20\nGLD 10',
              '每行一个持仓，例如\nAAPL 30\nTLT 20\nGLD 10',
            )}
          />

          <div className="flex items-center justify-between mt-3">
            <div className="text-[11px] text-black/45 dark:text-white/45">
              {t(
                'Supported: line format / CSV / JSON array',
                '支持：逐行 / CSV / JSON 数组',
              )}
            </div>
            <button
              type="button"
              onClick={runCheck}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 !text-xs text-black/70 dark:text-white/70 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition disabled:opacity-60"
            >
              {loading ? t('Checking...', '体检中...') : t('Run Check', '开始体检')}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3 overflow-hidden">
          {!result ? (
            <div className="h-full min-h-[320px] flex items-center justify-center text-sm text-black/50 dark:text-white/50">
              {t('No report yet.', '暂无体检报告。')}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
                  <div className="text-black/50 dark:text-white/50">{t('Risk Score', '风险评分')}</div>
                  <div className="text-black/80 dark:text-white/90 font-semibold">
                    {result.riskScore.toFixed(1)} / 100
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
                  <div className="text-black/50 dark:text-white/50">{t('Top Region', '区域集中')}</div>
                  <div className="text-black/80 dark:text-white/90 font-semibold">
                    {topRegion ? `${topRegion[0]} ${topRegion[1].toFixed(1)}%` : '-'}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
                  <div className="text-black/50 dark:text-white/50">{t('Top Sector', '行业集中')}</div>
                  <div className="text-black/80 dark:text-white/90 font-semibold">
                    {topSector ? `${topSector[0]} ${topSector[1].toFixed(1)}%` : '-'}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 p-2">
                <div className="text-[11px] font-semibold text-black/70 dark:text-white/70 mb-1">
                  {t('Rebalance Suggestions', '再平衡建议')}
                </div>
                <ul className="text-xs text-black/70 dark:text-white/70 space-y-1 list-disc pl-5">
                  {result.rebalanceSuggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 p-2">
                <div className="text-[11px] font-semibold text-black/70 dark:text-white/70 mb-1">
                  {t('Top Factor Sensitivities', '主要敏感因子')}
                </div>
                <div className="overflow-x-auto">
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
              </div>

              <details className="rounded-xl border border-light-200/60 dark:border-dark-200/60 p-2">
                <summary className="cursor-pointer text-[11px] font-semibold text-black/70 dark:text-white/70">
                  {t('Show Markdown Report', '查看 Markdown 报告')}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-[11px] text-black/65 dark:text-white/70 max-h-80 overflow-auto">
                  {markdown}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioCheckPage;
