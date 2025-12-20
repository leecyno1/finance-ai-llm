'use client';

import { useEffect, useMemo, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';

type MarketItem = {
  id: string;
  name: string;
  region: string;
  close: number;
  pct_chg: number;
  trade_date: string;
};

type MacroItem = {
  id: string;
  name: string;
  region: string;
  value: number;
  unit: string;
  period: string;
  prev_value?: number;
  prev_period?: string;
  frequency?: string;
};

type SummaryResponse = {
  source: string;
  reason?: 'missing_token' | 'tushare_failed';
  error?: {
    code?: number;
    message: string;
  };
  market: MarketItem[];
  macro: MacroItem[];
};

const formatNumber = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toFixed(digits) : '-';

const calcDelta = (cur: number, prev?: number) =>
  typeof prev === 'number' && Number.isFinite(prev) ? cur - prev : undefined;

const EconomyPage = () => {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<'ALL' | string>('ALL');
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await fetch('/api/economy/summary');
        const json = (await res.json()) as SummaryResponse;
        setData(json);
      } catch (err) {
        console.error('Failed to load economy summary page', err);
      }
    };

    fetchSummary();

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

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  const macro = useMemo(() => data?.macro ?? [], [data]);
  const regions = useMemo(
    () =>
      Array.from(new Set(macro.map((m) => m.region))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [macro],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = macro
      .filter((m) => (region === 'ALL' ? true : m.region === region))
      .filter((m) => {
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.region.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
    return list;
  }, [macro, query, region]);

  return (
    <div className="pt-6 pb-6">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-semibold text-black/85 dark:text-white/85">
            {t('Economy & Markets', '经济与市场')}
          </h1>
          <p className="text-[11px] text-black/50 dark:text-white/50 mt-1">
            {t('Latest snapshot · multi-source', '最新快照 · 多源聚合')}
          </p>
        </div>
        <div className="text-[11px] text-black/45 dark:text-white/45 whitespace-nowrap">
          {t('Indicators', '指标')}: {filtered.length}/{macro.length}
        </div>
      </div>

      {data?.source === 'demo' && (
        <div className="mb-4 rounded-2xl border border-amber-300/40 bg-amber-200/20 dark:border-amber-400/30 dark:bg-amber-400/10 px-4 py-3 text-xs text-black/70 dark:text-white/70">
          {data.reason === 'missing_token' ? (
            <div>
              当前为示例数据：未配置 TuShare Token。请在任意输入框输入{' '}
              <span className="font-semibold">8899174</span> 回车显示设置按钮，然后在{' '}
              <span className="font-semibold">Settings → Economy</span>{' '}
              中粘贴并保存 TuShare Token。
            </div>
          ) : (
            <div>
              当前为示例数据：TuShare 拉取失败（请检查 token 权限/余额/是否包含多余空格）。
              {data.error?.code !== undefined && (
                <span className="ml-2">错误码：{data.error.code}</span>
              )}
              {data.error?.message && (
                <div className="mt-1 text-black/60 dark:text-white/60">
                  {data.error.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3">
        <div className="text-xs font-semibold text-black/70 dark:text-white/70 mb-2">
          {t('Market overview', '市场概览')}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {data?.market?.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/40 dark:bg-dark-primary/30 px-3 py-2"
            >
              <div className="text-[11px] text-black/55 dark:text-white/55 truncate">
                {m.name}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-black/85 dark:text-white/85">
                  {formatNumber(m.close, 2)}
                </span>
                <span
                  className={`text-[11px] font-semibold whitespace-nowrap ${
                    m.pct_chg >= 0
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-green-500 dark:text-green-400'
                  }`}
                >
                  {m.pct_chg >= 0 ? '+' : ''}
                  {formatNumber(m.pct_chg, 2)}%
                </span>
              </div>
            </div>
          ))}
          {!data?.market?.length && (
            <div className="text-black/50 dark:text-white/50 text-xs">
              {t('No market data.', '暂无市场数据。')}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-2">
          <div>
            <div className="text-xs font-semibold text-black/70 dark:text-white/70">
              {t('Macro indicators', '宏观/产业/利率指标')}
            </div>
            <div className="text-[11px] text-black/45 dark:text-white/45 mt-1">
              {t(
                'Compact table view; all indicators are listed below.',
                '紧凑表格视图：全部指标在下方列表展示。',
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 w-full sm:w-64 rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/40 px-3 text-xs text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none"
              placeholder={t('Search indicators…', '搜索指标…')}
            />
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-9 rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/40 px-2 text-xs text-black/80 dark:text-white/80 focus:outline-none"
            >
              <option value="ALL">{t('All', '全部')}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[11px] text-black/50 dark:text-white/50">
                <th className="text-left font-semibold py-2 pr-3 min-w-[260px]">
                  {t('Indicator', '指标')}
                </th>
                <th className="text-left font-semibold py-2 pr-3 w-[70px]">
                  {t('Region', '地区')}
                </th>
                <th className="text-right font-semibold py-2 pr-3 w-[120px]">
                  {t('Latest', '最新')}
                </th>
                <th className="text-right font-semibold py-2 pr-3 w-[120px]">
                  {t('Prev', '上期')}
                </th>
                <th className="text-right font-semibold py-2 pr-3 w-[120px]">
                  {t('Δ', '变化')}
                </th>
                <th className="text-left font-semibold py-2 pr-3 w-[90px]">
                  {t('Freq', '频率')}
                </th>
                <th className="text-left font-semibold py-2 pr-0 w-[170px]">
                  {t('Period', '期')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-200/40 dark:divide-dark-200/40">
              {filtered.map((m) => {
                const delta = calcDelta(m.value, m.prev_value);
                const isFx = m.unit === 'CNY' || m.unit === 'JPY' || m.unit === 'USD';
                const isPct = m.unit === '%';
                const digits = isFx ? 4 : isPct ? 2 : 2;
                const deltaStr =
                  typeof delta === 'number'
                    ? `${delta >= 0 ? '+' : ''}${formatNumber(delta, digits)}`
                    : '-';
                const deltaClass =
                  typeof delta === 'number'
                    ? delta >= 0
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-green-500 dark:text-green-400'
                    : 'text-black/40 dark:text-white/40';

                return (
                  <tr
                    key={m.id}
                    className="hover:bg-light-200/40 hover:dark:bg-dark-200/30"
                  >
                    <td className="py-2 pr-3">
                      <div className="text-black/80 dark:text-white/85 font-medium">
                        {m.name}
                      </div>
                      <div className="text-[10px] text-black/45 dark:text-white/45 mt-0.5">
                        {m.id}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-black/60 dark:text-white/60">
                      {m.region}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-black/85 dark:text-white/85 whitespace-nowrap">
                      {formatNumber(m.value, digits)}
                      {m.unit}
                    </td>
                    <td className="py-2 pr-3 text-right text-black/60 dark:text-white/60 whitespace-nowrap">
                      {typeof m.prev_value === 'number'
                        ? `${formatNumber(m.prev_value, digits)}${m.unit}`
                        : '-'}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-semibold whitespace-nowrap ${deltaClass}`}
                    >
                      {deltaStr}
                    </td>
                    <td className="py-2 pr-3 text-black/55 dark:text-white/55 whitespace-nowrap">
                      {m.frequency ?? '-'}
                    </td>
                    <td className="py-2 pr-0 text-black/55 dark:text-white/55 whitespace-nowrap">
                      {m.period}
                      {m.prev_period ? ` / ${m.prev_period}` : ''}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-6 text-center text-black/50 dark:text-white/50"
                  >
                    {t('No indicators found.', '没有匹配的指标。')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default EconomyPage;
