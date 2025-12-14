'use client';

import { useEffect, useState } from 'react';
import EconomyTicker from '@/components/EconomyTicker';

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
  market: MarketItem[];
  macro: MacroItem[];
};

const EconomyPage = () => {
  const [data, setData] = useState<SummaryResponse | null>(null);

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
  }, []);

  return (
    <div className="pt-10 pb-8">
      <h1 className="text-2xl font-semibold mb-4 text-black/80 dark:text-white/80">
        经济与市场数据
      </h1>
      <p className="text-xs text-black/50 dark:text-white/50 mb-4">
        实时财经数据与资讯 · 多源聚合
      </p>

      <div className="grid md:grid-cols-[2fr,1fr] gap-4 mb-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
            市场概览
          </h2>
          <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3 space-y-2 text-xs">
            {data?.market?.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b border-light-200/40 dark:border-dark-200/40 last:border-b-0 py-1.5"
              >
                <span className="text-black/70 dark:text-white/80">
                  {m.name}
                </span>
                <span className="text-black/80 dark:text-white/80 font-semibold">
                  {m.close.toFixed(2)}{' '}
                  <span
                    className={
                      m.pct_chg >= 0
                        ? 'text-emerald-500 ml-1'
                        : 'text-red-500 ml-1'
                    }
                  >
                    ({m.pct_chg >= 0 ? '+' : ''}
                    {m.pct_chg.toFixed(2)}%)
                  </span>
                </span>
              </div>
            ))}
            {!data?.market?.length && (
              <div className="text-black/50 dark:text-white/50">
                暂无市场数据。
              </div>
            )}
          </div>
        </div>

        <div>
          <EconomyTicker />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
          宏观经济指标
        </h2>
        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3 grid md:grid-cols-2 gap-3 text-xs">
          {data?.macro?.map((m) => (
            <div
              key={m.id}
              className="flex flex-col border border-light-200/40 dark:border-dark-200/40 rounded-xl px-3 py-2"
            >
              <span className="text-black/60 dark:text-white/60 text-[11px]">
                {m.period}
              </span>
              <span className="text-black/80 dark:text-white/80 font-semibold mt-0.5">
                {m.name}
              </span>
              <span className="text-sm mt-1 text-black/80 dark:text-white/80">
                {m.value.toFixed(2)}
                {m.unit}
              </span>
            </div>
          ))}
          {!data?.macro?.length && (
            <div className="text-black/50 dark:text-white/50">
              暂无宏观经济数据。
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EconomyPage;
