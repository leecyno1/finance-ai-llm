'use client';

import { useEffect, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';
import { buildSummaryHref } from '@/lib/utils/newsSummaryHref';

type NewsItem = {
  title: string;
  content: string;
  url: string;
  thumbnail?: string;
};

const NewsTickerCompact = ({ limit = 3 }: { limit?: number }) => {
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );
  const [items, setItems] = useState<NewsItem[]>([]);

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
    const fetchNews = async () => {
      try {
        const res = await fetch('/api/news/finance');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list: NewsItem[] = (data.items || data.blogs || []).filter(
          (b: NewsItem) => !!b.title && !!b.content,
        );
        const next = list.slice(0, Math.max(1, limit));
        if (!active) return;
        setItems(next);
      } catch (err) {
        console.error('Failed to load compact finance news', err);
        setItems([]);
      }
    };

    fetchNews();
    return () => {
      active = false;
    };
  }, [limit]);

  const header = t('Latest headlines', '财经快讯');

  return (
    <div className="w-full bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 overflow-hidden">
      <div className="px-3 py-2 border-b border-light-200/60 dark:border-dark-200/60 text-xs font-semibold text-black/70 dark:text-white/70">
        {header}
      </div>
      <div className="divide-y divide-light-200/40 dark:divide-dark-200/40">
        {items.length ? (
          items.map((item, idx) => (
            <a
              key={idx}
              href={item.url ? buildSummaryHref(item.url, item.title, item.content) : '#'}
              className="block px-3 py-2 hover:bg-light-200/60 hover:dark:bg-dark-200/60 transition-colors"
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
          <div className="px-3 py-3 text-[11px] text-black/50 dark:text-white/50">
            {t(
              'No real finance headlines available right now.',
              '当前暂无真实财经快讯',
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsTickerCompact;
