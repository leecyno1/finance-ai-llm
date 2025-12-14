'use client';

import { useEffect, useState } from 'react';

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
  tickerMarket?: MarketItem[];
  macro: MacroItem[];
};

type TickerItem = {
  id: string;
  label: string;
  value: string;
  change?: number;
  kind: 'market' | 'macro';
  prevLabel?: string;
  unit?: string;
  frequency?: string;
};

const ROW_HEIGHT = 56; // keep in sync with h-14
const INTERVAL_MS = 5000;
const REFRESH_MS = 10 * 60 * 1000; // 每 10 分钟重新拉取一次数据

const EconomyTicker = () => {
  const [baseItems, setBaseItems] = useState<TickerItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [useTransition, setUseTransition] = useState(true);

  useEffect(() => {
    let active = true;

    const fetchSummary = async () => {
      try {
        const res = await fetch('/api/economy/summary');
        if (!res.ok) {
          throw new Error(`Failed to load economy summary: ${res.status}`);
        }
        const data = (await res.json()) as SummaryResponse;

        const sourceMarket = (data as any).tickerMarket ?? data.market ?? [];

        const marketItems: TickerItem[] = sourceMarket.map((m: any) => {
          const prevClose =
            typeof m.prev_close === 'number' ? m.prev_close : undefined;
          const unit = m.unit || '点';
          const frequency = m.frequency || '日度';

          return {
            id: `m-${m.id}`,
            label: `${m.name}`,
            value: `${m.close.toFixed(2)} (${m.pct_chg >= 0 ? '+' : ''}${m.pct_chg.toFixed(
              2,
            )}%)`,
            change: m.pct_chg,
            kind: 'market',
            prevLabel: prevClose !== undefined ? prevClose.toFixed(2) : undefined,
            unit,
            frequency,
          };
        });

        const macroItems: TickerItem[] = (data.macro || []).map((m) => ({
          id: `x-${m.id}`,
          label: `${m.name}`,
          value: `${m.value.toFixed(2)}${m.unit}`,
          kind: 'macro',
          unit: m.unit,
          prevLabel:
            typeof m.prev_value === 'number' ? m.prev_value.toFixed(2) : undefined,
          frequency: m.frequency || '月度/季度',
        }));

        let combined = [...marketItems, ...macroItems];

        // 确保基础数据不少于 100 条，不足则循环填充
        const baseLen = combined.length;
        while (combined.length < 100 && baseLen > 0) {
          const needed = Math.min(baseLen, 100 - combined.length);
          combined = combined.concat(combined.slice(0, needed));
        }

        if (!active) return;
        setBaseItems(combined);
        setOffset(0);
      } catch (err) {
        console.error('Failed to load economy summary for ticker', err);
      }
    };

    fetchSummary();
    const id = setInterval(fetchSummary, REFRESH_MS);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!baseItems.length) return;

    setUseTransition(true);
    setOffset(0);

    const id = setInterval(() => {
      setOffset((prev) => prev + 1);
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, [baseItems]);

  // 首尾无缝衔接：使用双份列表，并在到达第二份开头后无动画跳回 0
  useEffect(() => {
    const baseLen = baseItems.length;
    if (!baseLen) return;
    if (offset !== baseLen) return;

    const timeout = setTimeout(() => {
      setUseTransition(false);
      setOffset(0);
      requestAnimationFrame(() => setUseTransition(true));
    }, 500); // 对齐 transition duration

    return () => clearTimeout(timeout);
  }, [offset, baseItems.length]);

  const loopItems = baseItems.length
    ? [...baseItems, ...baseItems]
    : baseItems;

  return (
    <div className="w-full bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 h-full min-h-[20rem] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-light-200/60 dark:border-dark-200/60 text-xs font-semibold text-black/70 dark:text-white/70">
        市场与经济数据
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div
          className={`absolute inset-x-0 ${
            useTransition ? 'transition-transform duration-500 ease-out' : ''
          }`}
          style={
            loopItems.length
              ? { transform: `translateY(-${offset * ROW_HEIGHT}px)` }
              : undefined
          }
        >
          {loopItems.length ? (
            loopItems.map((item, index) => {
              const isMarket = item.kind === 'market';
              const isUp =
                isMarket && typeof item.change === 'number'
                  ? item.change >= 0
                  : false;

              const valueColorClass = isMarket
                ? isUp
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-green-500 dark:text-green-400'
                : 'text-amber-600 dark:text-amber-400';

              return (
                <div
                  key={`${item.id}-${index}`}
                  className="flex items-center justify-between px-3 py-1.5 h-14 text-xs border-b border-light-200/40 dark:border-dark-200/40 last:border-b-0"
                >
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex h-5 px-1.5 rounded-full bg-light-200/80 dark:bg-dark-200/80 text-[10px] text-black/70 dark:text-white/70 shrink-0">
                        {item.kind === 'market' ? '指数' : '宏观'}
                      </span>
                      <span className="text-black/80 dark:text-white/85 font-medium truncate">
                        {item.label}
                      </span>
                    </div>
                    {(item.prevLabel || item.unit || item.frequency) && (
                      <div className="mt-0.5 text-[10px] text-black/50 dark:text-white/50 truncate">
                        {item.kind === 'market'
                          ? `上期 ${
                              item.prevLabel ?? '-'
                            }${item.unit ?? ''} · ${item.frequency ?? ''}`
                          : `${item.frequency ?? ''} · 单位：${item.unit ?? ''}`}
                      </div>
                    )}
                  </div>
                  <span
                    className={`ml-2 text-[11px] font-semibold whitespace-nowrap ${valueColorClass}`}
                  >
                    {item.value}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-[11px] text-black/50 dark:text-white/50">
              正在加载市场与经济数据…
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EconomyTicker;
