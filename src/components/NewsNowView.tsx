'use client';

import { useEffect, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';

type FinanceNewsItem = {
  title: string;
  content: string;
  url: string;
  source: string;
  datetime: string;
};

const NewsNowView = () => {
  const [items, setItems] = useState<FinanceNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const res = await fetch('/api/news/finance');
        const data = await res.json();
        setItems(data.items || data.blogs || []);
      } catch (err) {
        console.error('Failed to load NewsNow finance news', err);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();

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

  const titleText =
    language === 'zh' ? '实时快讯' : 'Live Finance Feed';
  const subtitleText =
    language === 'zh'
      ? '聚合华尔街见闻、财联社、新浪财经、搜狐财经、人民网等公开新闻源，按时间滚动展示。'
      : 'Aggregated live finance headlines from major public news sources.';

  return (
    <div className="py-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-black/85 dark:text-white/85">
            {titleText}
          </h1>
          <p className="text-sm text-black/55 dark:text-white/55">
            {subtitleText}
          </p>
        </div>

        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/70 dark:bg-dark-secondary/70 shadow-sm shadow-light-200/10 dark:shadow-black/25 overflow-hidden">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-sm text-black/50 dark:text-white/50">
              {language === 'zh'
                ? '正在加载最新财经快讯…'
                : 'Loading latest finance headlines…'}
            </div>
          ) : !items.length ? (
            <div className="py-10 flex items-center justify-center text-sm text-black/50 dark:text-white/50">
              {language === 'zh'
                ? '当前暂时没有可用的财经快讯。'
                : 'No finance headlines available at the moment.'}
            </div>
          ) : (
            <ul className="divide-y divide-light-200/70 dark:divide-dark-200/70">
              {items.slice(0, 80).map((item, idx) => (
                <li key={idx} className="hover:bg-light-100/70 hover:dark:bg-dark-200/60 transition-colors">
                  <a
                    href={item.url || '#'}
                    target={item.url ? '_blank' : undefined}
                    rel="noreferrer"
                    className="block px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-black/90 dark:text-white line-clamp-2">
                        {item.title}
                      </h2>
                      <span className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-light-200/90 dark:bg-dark-200/90 text-black/60 dark:text-white/60">
                        {item.source || 'News'}
                      </span>
                    </div>
                    {item.content && (
                      <p className="mt-1 text-xs text-black/60 dark:text-white/60 line-clamp-2">
                        {item.content}
                      </p>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewsNowView;
