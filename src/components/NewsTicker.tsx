'use client';

import { useEffect, useState } from 'react';
import { buildSummaryHref } from '@/lib/utils/newsSummaryHref';

type NewsItem = {
  title: string;
  content: string;
  url: string;
  thumbnail?: string;
};

const ROW_HEIGHT = 64; // px
const INTERVAL_MS = 5000;
const REFRESH_MS = 10 * 60 * 1000; // 每 10 分钟重新拉取一次新闻

const NewsTicker = () => {
  const [baseItems, setBaseItems] = useState<NewsItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [useTransition, setUseTransition] = useState(true);

  useEffect(() => {
    let active = true;

    const fetchNews = async () => {
      try {
        const res = await fetch('/api/news/finance');
        if (!res.ok) {
          throw new Error(`Failed to load finance news: ${res.status}`);
        }
        const data = await res.json();
        const itemsFromApi: NewsItem[] = (data.items || data.blogs || []).filter(
          (b: NewsItem) => !!b.title && !!b.content,
        );
        let combined = itemsFromApi;

        // 确保不少于 100 条，不足则循环补足
        const baseLen = combined.length;
        while (combined.length < 100 && baseLen > 0) {
          const needed = Math.min(baseLen, 100 - combined.length);
          combined = combined.concat(combined.slice(0, needed));
        }

        if (!active) return;
        setBaseItems(combined);
        setOffset(0);
      } catch (err) {
        console.error('Failed to load finance news for ticker', err);
        setBaseItems([]);
      }
    };

    fetchNews();
    const id = setInterval(fetchNews, REFRESH_MS);

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

  // 首尾无缝衔接：双列表 + 无动画回跳
  useEffect(() => {
    const baseLen = baseItems.length;
    if (!baseLen) return;
    if (offset !== baseLen) return;

    const timeout = setTimeout(() => {
      setUseTransition(false);
      setOffset(0);
      requestAnimationFrame(() => setUseTransition(true));
    }, 500);

    return () => clearTimeout(timeout);
  }, [offset, baseItems.length]);

  const loopItems = baseItems.length
    ? [...baseItems, ...baseItems]
    : baseItems;

  return (
    <div className="w-full bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 h-full min-h-[20rem] flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-light-200/60 dark:border-dark-200/60 text-xs font-semibold text-black/70 dark:text-white/70">
        财经快讯
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
            loopItems.map((item, idx) => (
              <a
                key={idx}
                href={item.url ? buildSummaryHref(item.url, item.title, item.content) : '#'}
                className="block px-3 py-2 h-16 border-b border-light-200/40 dark:border-dark-200/40 last:border-b-0 hover:bg-light-200/60 hover:dark:bg-dark-200/60 transition-colors"
              >
                <p className="text-xs font-semibold text-black/90 dark:text-white line-clamp-2">
                  {item.title}
                </p>
                <p className="text-[11px] text-black/55 dark:text-white/55 line-clamp-1 mt-0.5">
                  {item.content}
                </p>
              </a>
            ))
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-[11px] text-black/50 dark:text-white/50">
              暂无可用实时财经新闻（仅展示真实源数据）
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewsTicker;
