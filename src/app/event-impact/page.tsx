'use client';

import { useEffect, useMemo, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';

type Direction = 'positive' | 'negative' | 'mixed' | 'neutral';

type EventImpactItem = {
  event: string;
  source: string;
  sourceUrl: string;
  timestamp: string;
  sectors: string[];
  assets: string[];
  direction: Direction;
  confidence: number;
  rationale: string;
  matchedKeywords: string[];
};

type EventImpactResponse = {
  ok: boolean;
  cached: boolean;
  updatedAt: number;
  newsUpdatedAt: string;
  count: number;
  total: number;
  matrix: EventImpactItem[];
};

const REFRESH_MS = 10 * 60 * 1000;

const dirText = (dir: Direction, lang: 'en' | 'zh') => {
  if (lang === 'en') {
    if (dir === 'positive') return 'Positive';
    if (dir === 'negative') return 'Negative';
    if (dir === 'mixed') return 'Mixed';
    return 'Neutral';
  }
  if (dir === 'positive') return '利多';
  if (dir === 'negative') return '利空';
  if (dir === 'mixed') return '分化';
  return '中性';
};

const dirClass = (dir: Direction) => {
  if (dir === 'positive') return 'text-red-500 dark:text-red-400';
  if (dir === 'negative') return 'text-green-600 dark:text-green-400';
  if (dir === 'mixed') return 'text-amber-600 dark:text-amber-400';
  return 'text-black/60 dark:text-white/60';
};

const EventImpactPage = () => {
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<EventImpactItem[]>([]);
  const [meta, setMeta] = useState<{ cached: boolean; updatedAt?: number; total?: number }>({
    cached: false,
  });

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  const fetchRows = async (q: string) => {
    setLoading(true);
    try {
      const u = new URL('/api/finance/event-impact', window.location.origin);
      if (q.trim()) u.searchParams.set('q', q.trim());
      u.searchParams.set('limit', '120');

      const res = await fetch(u.toString(), { cache: 'no-store' });
      const data = (await res.json()) as EventImpactResponse;

      if (!res.ok || !data.ok) {
        throw new Error('Failed to load event-impact matrix');
      }

      setRows(data.matrix || []);
      setMeta({ cached: data.cached, updatedAt: data.updatedAt, total: data.total });
    } catch (err) {
      console.error('Failed to load event-impact matrix', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows('');
    const timer = setInterval(() => fetchRows(query), REFRESH_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      fetchRows(query);
    }, 280);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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

  const stats = useMemo(() => {
    const out = {
      positive: 0,
      negative: 0,
      mixed: 0,
      neutral: 0,
    };

    rows.forEach((r) => {
      out[r.direction] += 1;
    });

    return out;
  }, [rows]);

  return (
    <div className="pt-6 pb-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-black/85 dark:text-white/85">
            {t('Event-Asset Impact Matrix', '事件-资产影响矩阵')}
          </h1>
          <p className="text-[11px] text-black/50 dark:text-white/50 mt-1">
            {t(
              'Auto-mapped from real finance news with direction and confidence.',
              '基于真实财经新闻自动映射行业/资产，并给出方向与置信度。',
            )}
          </p>
        </div>
        <div className="text-[11px] text-black/45 dark:text-white/45">
          {t('Rows', '条目')}: {rows.length}
          {typeof meta.total === 'number' ? ` / ${meta.total}` : ''} ·{' '}
          {meta.cached ? t('cache hit', '缓存命中') : t('fresh', '实时计算')}
        </div>
      </div>

      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3 mb-4">
        <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
              <div className="text-black/50 dark:text-white/50">{t('Positive', '利多')}</div>
              <div className="text-red-500 dark:text-red-400 font-semibold">{stats.positive}</div>
            </div>
            <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
              <div className="text-black/50 dark:text-white/50">{t('Negative', '利空')}</div>
              <div className="text-green-600 dark:text-green-400 font-semibold">{stats.negative}</div>
            </div>
            <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
              <div className="text-black/50 dark:text-white/50">{t('Mixed', '分化')}</div>
              <div className="text-amber-600 dark:text-amber-400 font-semibold">{stats.mixed}</div>
            </div>
            <div className="rounded-lg px-3 py-2 bg-light-primary/70 dark:bg-dark-primary/60">
              <div className="text-black/50 dark:text-white/50">{t('Neutral', '中性')}</div>
              <div className="text-black/70 dark:text-white/80 font-semibold">{stats.neutral}</div>
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full md:w-72 rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/40 px-3 text-xs text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none"
            placeholder={t('Search event / asset / sector...', '搜索事件/行业/资产关键词...')}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3 overflow-x-auto">
        {loading ? (
          <div className="py-10 text-center text-sm text-black/50 dark:text-white/50">
            {t('Loading...', '加载中...')}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-black/50 dark:text-white/50">
            {t('No matched events.', '没有匹配到事件。')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[11px] text-black/50 dark:text-white/50">
                <th className="text-left py-2 pr-3 min-w-[260px]">{t('Event', '事件')}</th>
                <th className="text-left py-2 pr-3 min-w-[120px]">{t('Direction', '方向')}</th>
                <th className="text-right py-2 pr-3 min-w-[90px]">{t('Confidence', '置信度')}</th>
                <th className="text-left py-2 pr-3 min-w-[260px]">{t('Targets', '影响标的')}</th>
                <th className="text-left py-2 pr-3 min-w-[280px]">{t('Rationale', '逻辑')}</th>
                <th className="text-left py-2 min-w-[160px]">{t('Source', '来源')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-light-200/40 dark:divide-dark-200/40">
              {rows.map((row, i) => (
                <tr key={`${row.event}-${i}`}>
                  <td className="py-2 pr-3 align-top text-black/80 dark:text-white/85">
                    <div className="font-medium">{row.event}</div>
                    {row.timestamp ? (
                      <div className="text-[10px] mt-0.5 text-black/45 dark:text-white/45">
                        {row.timestamp}
                      </div>
                    ) : null}
                  </td>
                  <td className={`py-2 pr-3 align-top font-semibold ${dirClass(row.direction)}`}>
                    {dirText(row.direction, language)}
                  </td>
                  <td className="py-2 pr-3 align-top text-right font-semibold text-black/75 dark:text-white/80">
                    {(row.confidence * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 pr-3 align-top text-black/65 dark:text-white/70">
                    {[...row.sectors, ...row.assets].slice(0, 8).join('、')}
                  </td>
                  <td className="py-2 pr-3 align-top text-black/60 dark:text-white/65">
                    {row.rationale}
                  </td>
                  <td className="py-2 align-top">
                    {row.sourceUrl ? (
                      <a
                        href={row.sourceUrl}
                        target="_blank"
                        className="text-cyan-700 dark:text-cyan-300 hover:underline"
                        rel="noreferrer"
                      >
                        {row.source}
                      </a>
                    ) : (
                      <span className="text-black/55 dark:text-white/60">{row.source}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default EventImpactPage;
