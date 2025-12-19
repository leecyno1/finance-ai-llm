'use client';

import { useEffect, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';

type MarketItem = {
  id: string;
  name: string;
  region: string;
  close: number;
  pct_chg: number;
  trade_date: string;
  unit?: string;
  frequency?: string;
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
  market: MarketItem[];
  macro: MacroItem[];
};

type Row = {
  key: string;
  label: string;
  value: string;
  change?: number;
  kind: 'market' | 'macro';
  frequency?: string;
  unit?: string;
};

const pickByNamePriority = <T extends { name: string }>(
  items: T[],
  namePriority: string[],
  limit: number,
) => {
  const picked: T[] = [];
  const remaining = [...items];
  for (const p of namePriority) {
    const idx = remaining.findIndex((it) => it.name.includes(p));
    if (idx >= 0) {
      picked.push(remaining[idx]);
      remaining.splice(idx, 1);
      if (picked.length >= limit) return picked;
    }
  }
  while (picked.length < limit && remaining.length) {
    picked.push(remaining.shift()!);
  }
  return picked;
};

const pickByIdPriority = <T extends { id: string }>(
  items: T[],
  idPriority: string[],
  limit: number,
) => {
  const picked: T[] = [];
  const remaining = [...items];
  for (const p of idPriority) {
    const idx = remaining.findIndex((it) => it.id === p);
    if (idx >= 0) {
      picked.push(remaining[idx]);
      remaining.splice(idx, 1);
      if (picked.length >= limit) return picked;
    }
  }
  while (picked.length < limit && remaining.length) {
    picked.push(remaining.shift()!);
  }
  return picked;
};

const formatNumber = (v: number, digits: number) => {
  if (!Number.isFinite(v)) return '-';
  return v.toFixed(digits);
};

const EconomyTickerCompact = ({
  marketLimit = 3,
  macroLimit = 2,
}: {
  marketLimit?: number;
  macroLimit?: number;
}) => {
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );
  const [rows, setRows] = useState<Row[]>([]);

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

  useEffect(() => {
    let active = true;
    const fetchSummary = async () => {
      try {
        const res = await fetch('/api/economy/summary');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SummaryResponse;

        const marketPriority = ['上证', '沪深300', '标普', '纳斯达克', '恒生', '道琼斯'];
        const macroPriority = [
          'CN_10Y_YIELD',
          'CN_5Y_YIELD',
          'CN_3Y_YIELD',
          'US_10Y_YIELD',
          'US_5Y_YIELD',
          'US_3Y_YIELD',
          'USD_CNY',
          'CN_CPI_YOY',
          'CN_PPI_YOY',
          'CN_PMI_MFG',
          'CN_M2_YOY',
          'US_SOFR',
          'US_RRP',
        ];

        const pickedMarket = pickByNamePriority(
          data.market ?? [],
          marketPriority,
          marketLimit,
        );
        const pickedMacro = pickByIdPriority(
          data.macro ?? [],
          macroPriority,
          macroLimit,
        );

        const nextRows: Row[] = [];
        for (const m of pickedMarket) {
          const unit = m.unit || '点';
          nextRows.push({
            key: `m-${m.id}`,
            label: m.name,
            value: `${formatNumber(m.close, 2)}${unit}`,
            change: m.pct_chg,
            kind: 'market',
            unit,
            frequency: m.frequency || '日度',
          });
        }

        for (const x of pickedMacro) {
          const unit = x.unit || '';
          const digits = unit === '%' ? 2 : unit === 'CNY' || unit === 'JPY' ? 4 : 2;
          nextRows.push({
            key: `x-${x.id}`,
            label: x.name,
            value: `${formatNumber(x.value, digits)}${unit}`,
            kind: 'macro',
            unit,
            frequency: x.frequency,
          });
        }

        if (!active) return;
        setRows(nextRows);
      } catch (err) {
        console.error('Failed to load compact economy summary', err);
      }
    };

    fetchSummary();
    return () => {
      active = false;
    };
  }, [marketLimit, macroLimit]);

  const header = t('Market snapshot', '市场与经济快照');

  return (
    <div className="w-full bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 overflow-hidden">
      <div className="px-3 py-2 border-b border-light-200/60 dark:border-dark-200/60 text-xs font-semibold text-black/70 dark:text-white/70">
        {header}
      </div>
      <div className="divide-y divide-light-200/40 dark:divide-dark-200/40">
        {rows.length ? (
          rows.map((r) => {
            const isUp = r.kind === 'market' && typeof r.change === 'number' && r.change >= 0;
            const valueColorClass =
              r.kind === 'market'
                ? isUp
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-green-500 dark:text-green-400'
                : 'text-amber-600 dark:text-amber-400';

            return (
              <div key={r.key} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="min-w-0 pr-3">
                  <div className="text-black/85 dark:text-white/85 font-medium truncate">
                    {r.label}
                  </div>
                  {r.frequency && (
                    <div className="mt-0.5 text-[10px] text-black/50 dark:text-white/50 truncate">
                      {r.frequency}
                      {r.kind === 'market' && typeof r.change === 'number'
                        ? ` · ${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}%`
                        : ''}
                    </div>
                  )}
                </div>
                <div className={`text-[11px] font-semibold whitespace-nowrap ${valueColorClass}`}>
                  {r.value}
                </div>
              </div>
            );
          })
        ) : (
          <div className="px-3 py-3 text-[11px] text-black/50 dark:text-white/50">
            {t('Loading…', '加载中…')}
          </div>
        )}
      </div>
    </div>
  );
};

export default EconomyTickerCompact;
