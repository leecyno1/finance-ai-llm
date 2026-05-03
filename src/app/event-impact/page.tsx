'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClientLanguage } from '@/lib/hooks/useClientLanguage';

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
  importanceScore: number;
  rationale: string;
  matchedKeywords: string[];
};

type KeyEventExample = {
  title: string;
  source: string;
  sourceUrl: string;
  timestamp: string;
  direction: Direction;
  confidence: number;
  importanceScore: number;
};

type KeyEventInsight = {
  rank: number;
  themeKey: string;
  title: string;
  direction: Direction;
  confidence: number;
  importanceScore: number;
  compositeScore: number;
  articleCount: number;
  sourceCount: number;
  sentiment: {
    positive: number;
    negative: number;
    mixed: number;
    neutral: number;
  };
  targets: string[];
  rationale: string;
  examples: KeyEventExample[];
  scoreBreakdown: {
    eventStrength: number;
    coverage: number;
    directionClarity: number;
    recency: number;
  };
};

type TargetImpactSummary = {
  target: string;
  positiveWeight: number;
  mixedWeight: number;
  negativeWeight: number;
  direction: 'positive' | 'mixed' | 'negative';
  confidence: number;
  eventCount: number;
  totalWeight: number;
  compositeScore: number;
  scoreBreakdown: {
    confidence: number;
    eventCoverage: number;
    signalClarity: number;
  };
};

type FundRecommendationItem = {
  tsCode: string;
  name: string;
  category: string;
  style: string;
  riskLevel: string;
  manager: string;
  ret6m: number | null;
  ret1y: number | null;
  scaleYi: number | null;
  matchScore: number;
  reason: string;
  riskPrompt: string;
};

type TargetFundRecommendation = {
  target: string;
  direction: 'positive' | 'mixed' | 'negative';
  confidence: number;
  eventCount: number;
  funds: FundRecommendationItem[];
  riskHint: string;
};

type ScoringTemplate = {
  name: string;
  formula: string;
  weights: Record<string, number>;
  notes: string[];
};

type EventImpactResponse = {
  ok: boolean;
  cached: boolean;
  updatedAt: number;
  newsUpdatedAt: string;
  count: number;
  total: number;
  matrix: EventImpactItem[];
  keyEvents: KeyEventInsight[];
  keyEventScoringTemplate?: ScoringTemplate;
  summary: TargetImpactSummary[];
  targetScoringTemplate?: ScoringTemplate;
  fundRecommendations: TargetFundRecommendation[];
  fundRecommendationPanel: TargetFundRecommendation[];
  analysisMeta?: {
    rawNewsCount: number;
    uniqueNewsCount: number;
    duplicateNewsCount: number;
    eventRowsAnalyzed: number;
    keyEventsCount: number;
    allNewsSummaryCount: number;
    keyEventSummaryCount: number;
    blendWeights: {
      allNews: number;
      top5KeyEvents: number;
    };
  };
};

const REFRESH_MS = 6 * 60 * 60 * 1000;

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

const dirBadgeClass = (dir: Direction) => {
  if (dir === 'positive') {
    return 'border-red-400/35 bg-red-500/12 text-red-700 dark:text-red-300';
  }
  if (dir === 'negative') {
    return 'border-emerald-400/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
  }
  if (dir === 'mixed') {
    return 'border-amber-400/35 bg-amber-500/12 text-amber-700 dark:text-amber-300';
  }
  return 'border-light-200/60 dark:border-dark-200/60 bg-light-primary/50 dark:bg-dark-primary/40 text-black/60 dark:text-white/60';
};

const dirSurfaceClass = (dir: Direction) => {
  if (dir === 'positive') {
    return 'border-red-400/30 bg-gradient-to-br from-red-50/70 via-orange-50/50 to-light-primary/45 dark:from-red-900/20 dark:via-orange-900/10 dark:to-dark-primary/35';
  }
  if (dir === 'negative') {
    return 'border-emerald-400/30 bg-gradient-to-br from-emerald-50/70 via-cyan-50/50 to-light-primary/45 dark:from-emerald-900/20 dark:via-cyan-900/10 dark:to-dark-primary/35';
  }
  if (dir === 'mixed') {
    return 'border-amber-400/30 bg-gradient-to-br from-amber-50/70 via-yellow-50/50 to-light-primary/45 dark:from-amber-900/20 dark:via-yellow-900/10 dark:to-dark-primary/35';
  }
  return 'border-light-200/60 dark:border-dark-200/60 bg-light-primary/45 dark:bg-dark-primary/35';
};

const rankChipClass = (rank: number) => {
  if (rank === 1) return 'bg-amber-500/20 text-amber-700 dark:text-amber-300';
  if (rank === 2) return 'bg-slate-400/20 text-slate-700 dark:text-slate-300';
  if (rank === 3) return 'bg-orange-400/20 text-orange-700 dark:text-orange-300';
  return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300';
};

const EventImpactPage = () => {
  const language = useClientLanguage('zh');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<EventImpactItem[]>([]);
  const [keyEvents, setKeyEvents] = useState<KeyEventInsight[]>([]);
  const [summaryRows, setSummaryRows] = useState<TargetImpactSummary[]>([]);
  const [fundRecommendationPanel, setFundRecommendationPanel] = useState<
    TargetFundRecommendation[]
  >([]);
  const [targetScoringTemplate, setTargetScoringTemplate] =
    useState<ScoringTemplate | null>(null);
  const [keyEventScoringTemplate, setKeyEventScoringTemplate] =
    useState<ScoringTemplate | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; updatedAt?: number; total?: number }>({
    cached: false,
  });
  const [analysisMeta, setAnalysisMeta] = useState<
    EventImpactResponse['analysisMeta'] | null
  >(null);

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  const fetchRows = async (q: string) => {
    setLoading(true);
    try {
      const u = new URL('/api/finance/event-impact', window.location.origin);
      if (q.trim()) u.searchParams.set('q', q.trim());
      u.searchParams.set('limit', '10');

      const res = await fetch(u.toString(), { cache: 'no-store' });
      const data = (await res.json()) as EventImpactResponse;

      if (!res.ok || !data.ok) {
        throw new Error('Failed to load event-impact');
      }

      setRows(data.matrix || []);
      setKeyEvents((data.keyEvents || []).slice(0, 5));
      setSummaryRows(data.summary || []);
      setFundRecommendationPanel((data.fundRecommendationPanel || []).slice(0, 10));
      setTargetScoringTemplate(data.targetScoringTemplate || null);
      setKeyEventScoringTemplate(data.keyEventScoringTemplate || null);
      setMeta({ cached: data.cached, updatedAt: data.updatedAt, total: data.total });
      setAnalysisMeta(data.analysisMeta || null);
    } catch (err) {
      console.error('Failed to load event-impact', err);
      setRows([]);
      setKeyEvents([]);
      setSummaryRows([]);
      setFundRecommendationPanel([]);
      setAnalysisMeta(null);
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
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const summaryStats = useMemo(() => {
    const out = { positive: 0, mixed: 0, negative: 0 };
    summaryRows.forEach((r) => {
      if (r.direction === 'positive') out.positive += 1;
      else if (r.direction === 'negative') out.negative += 1;
      else out.mixed += 1;
    });
    return out;
  }, [summaryRows]);

  const keyEventStats = useMemo(() => {
    const out = { positive: 0, mixed: 0, negative: 0, neutral: 0 };
    keyEvents.forEach((row) => {
      out.positive += row.sentiment.positive;
      out.negative += row.sentiment.negative;
      out.mixed += row.sentiment.mixed;
      out.neutral += row.sentiment.neutral;
    });
    return out;
  }, [keyEvents]);

  return (
    <div className="pt-6 pb-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-black/85 dark:text-white/85">
            {t('Event-driven Signals', '事件驱动')}
          </h1>
          <p className="text-[11px] text-black/50 dark:text-white/50 mt-1">
            {t(
              'Top-5 key events aggregated from all news with auditable examples, then target scoring and fund actions.',
              '先对全部新闻做聚类归纳，给出可追溯的 Top5 关键事件，再输出标的打分与基金动作建议。',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-56 md:w-72 rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/40 px-3 text-xs text-black/80 dark:text-white/80 placeholder:text-black/40 dark:placeholder:text-white/40 focus:outline-none"
            placeholder={t('Search event / target...', '搜索事件/标的关键词...')}
          />
          <div className="text-[11px] text-black/45 dark:text-white/45 whitespace-nowrap">
            {t('Rows', '条目')}: {rows.length}
            {typeof meta.total === 'number' ? ` / ${meta.total}` : ''} ·{' '}
            {meta.cached ? t('cache hit', '缓存命中') : t('fresh', '实时计算')}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-gradient-to-br from-light-secondary/70 via-light-primary/60 to-light-secondary/45 dark:from-dark-secondary/70 dark:via-dark-primary/55 dark:to-dark-secondary/45 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-black/75 dark:text-white/80">
            {t('Top 5 Key Events', '重要事件列表（Top 5）')}
          </h2>
          <div className="text-[11px] text-black/45 dark:text-white/45">
            {t('Sample', '样本')}: {meta.total || 0} ·{' '}
            {t('Bullish', '利多')}: {keyEventStats.positive} · {t('Mixed', '分化')}:{' '}
            {keyEventStats.mixed} · {t('Bearish', '利空')}: {keyEventStats.negative}
          </div>
        </div>

        {analysisMeta ? (
          <div className="mb-3 rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/50 dark:bg-dark-primary/40 px-3 py-2 text-[11px] text-black/60 dark:text-white/60">
            <div className="font-medium text-black/75 dark:text-white/80 mb-1">
              {t('Sample & Weighting', '样本与权重说明')}
            </div>
            <div>
              {t('Raw news', '原始新闻')}: {analysisMeta.rawNewsCount} ·{' '}
              {t('Unique', '去重后')}: {analysisMeta.uniqueNewsCount} ·{' '}
              {t('Analyzed event rows', '可解析事件')}: {analysisMeta.eventRowsAnalyzed} ·{' '}
              {t('Top key events', '关键事件')}: {analysisMeta.keyEventsCount}
            </div>
            <div className="mt-0.5">
              {t('Summary blend', '汇总权重')}：{t('All-news', '全量新闻')}{' '}
              {(analysisMeta.blendWeights.allNews * 100).toFixed(0)}% + Top5{' '}
              {(analysisMeta.blendWeights.top5KeyEvents * 100).toFixed(0)}%
            </div>
          </div>
        ) : null}

        {keyEventScoringTemplate ? (
          <div className="mb-3 rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/50 dark:bg-dark-primary/40 px-3 py-2 text-[11px] text-black/60 dark:text-white/60">
            <div className="font-medium text-black/75 dark:text-white/80 mb-1">
              {t('Scoring Template', '打分模板')}: {keyEventScoringTemplate.name}
            </div>
            <div>{keyEventScoringTemplate.formula}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="py-10 text-center text-sm text-black/50 dark:text-white/50">
            {t('Loading...', '加载中...')}
          </div>
        ) : keyEvents.length === 0 ? (
          <div className="py-10 text-center text-sm text-black/50 dark:text-white/50">
            {t('No key events.', '暂无关键事件。')}
          </div>
        ) : (
          <div className="space-y-3">
            {keyEvents.map((event) => (
              <div
                key={event.themeKey}
                className={`rounded-xl border p-3 ${dirSurfaceClass(event.direction)}`}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${rankChipClass(event.rank)}`}
                      >
                        {event.rank}
                      </span>
                      <h3 className="text-sm font-semibold text-black/85 dark:text-white/90">
                        {event.title}
                      </h3>
                    </div>
                    <div className="mt-1 text-[11px] text-black/55 dark:text-white/60">
                      {event.rationale}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
                    <div
                      className={`inline-flex w-fit rounded-full border px-2 py-0.5 font-semibold ${dirBadgeClass(event.direction)}`}
                    >
                      {dirText(event.direction, language)}
                    </div>
                    <div className="text-black/70 dark:text-white/75">
                      {t('Importance', '重要度')}: {event.compositeScore.toFixed(1)}
                    </div>
                    <div className="text-black/70 dark:text-white/75">
                      {t('Confidence', '置信度')}: {(event.confidence * 100).toFixed(0)}%
                    </div>
                    <div className="text-black/60 dark:text-white/65">
                      {t('Articles', '新闻数')}: {event.articleCount}
                    </div>
                    <div className="text-black/60 dark:text-white/65">
                      {t('Sources', '来源数')}: {event.sourceCount}
                    </div>
                    <div className="text-black/60 dark:text-white/65">
                      {t('Targets', '标的')}: {event.targets.length}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {event.targets.slice(0, 6).map((target) => (
                    <span
                      key={`${event.themeKey}-${target}`}
                      className="rounded-full border border-light-200/70 dark:border-dark-200/70 px-2 py-0.5 text-black/60 dark:text-white/60"
                    >
                      {target}
                    </span>
                  ))}
                </div>

                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-black/60 dark:text-white/65">
                  <div>{t('Bullish', '利多')}: {event.sentiment.positive}</div>
                  <div>{t('Mixed', '分化')}: {event.sentiment.mixed}</div>
                  <div>{t('Bearish', '利空')}: {event.sentiment.negative}</div>
                  <div>{t('Neutral', '中性')}: {event.sentiment.neutral}</div>
                </div>

                <div className="mt-2 rounded-lg border border-light-200/60 dark:border-dark-200/60 bg-light-secondary/45 dark:bg-dark-secondary/45 p-2">
                  <div className="mb-1 text-[10px] text-black/50 dark:text-white/55">
                    {t('Composite breakdown', '综合分拆解')}：
                    {t(' strength ', ' 强度 ')}{event.scoreBreakdown.eventStrength.toFixed(1)} ·
                    {t(' coverage ', ' 覆盖 ')}{event.scoreBreakdown.coverage.toFixed(1)} ·
                    {t(' clarity ', ' 清晰度 ')}{event.scoreBreakdown.directionClarity.toFixed(1)} ·
                    {t(' recency ', ' 时效 ')}{event.scoreBreakdown.recency.toFixed(1)}
                  </div>
                  <div className="text-[11px] font-medium text-black/70 dark:text-white/75 mb-1">
                    {t('Raw examples', '原始新闻实例')}
                  </div>
                  <div className="space-y-1.5">
                    {event.examples.slice(0, 3).map((ex, idx) => (
                      <div
                        key={`${event.themeKey}-ex-${idx}`}
                        className="text-[11px] text-black/60 dark:text-white/65"
                      >
                        <span className={`mr-1 font-semibold ${dirClass(ex.direction)}`}>
                          [{dirText(ex.direction, language)}]
                        </span>
                        {ex.sourceUrl ? (
                          <a
                            href={ex.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline text-cyan-700 dark:text-cyan-300"
                          >
                            {ex.title}
                          </a>
                        ) : (
                          <span>{ex.title}</span>
                        )}
                        <span className="ml-1 text-black/45 dark:text-white/50">
                          ({ex.source || '-'}{ex.timestamp ? ` · ${ex.timestamp}` : ''})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-black/75 dark:text-white/80">
              {t('Today Target Summary', '今日标的影响汇总')}
            </h2>
            <div className="text-[11px] text-black/45 dark:text-white/45">
              {t('Targets', '标的数')}: {summaryRows.length} ·{' '}
              {t('Bullish', '利多')}: {summaryStats.positive} · {t('Mixed', '分化')}:{' '}
              {summaryStats.mixed} · {t('Bearish', '利空')}: {summaryStats.negative}
            </div>
          </div>

          {targetScoringTemplate ? (
            <div className="mb-2 rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/50 dark:bg-dark-primary/40 p-2 text-[11px] text-black/60 dark:text-white/60">
              <div className="font-medium text-black/75 dark:text-white/80 mb-1">
                {targetScoringTemplate.name}
              </div>
              <div>{targetScoringTemplate.formula}</div>
              {targetScoringTemplate.notes?.slice(0, 3).map((note, idx) => (
                <div key={`score-note-${idx}`} className="mt-0.5">
                  • {note}
                </div>
              ))}
              {summaryRows[0] ? (
                <div className="mt-1.5 text-[10px] text-black/55 dark:text-white/60">
                  {t('Top target breakdown', 'Top1拆解')}：C {summaryRows[0].scoreBreakdown.confidence.toFixed(1)} ·
                  E {summaryRows[0].scoreBreakdown.eventCoverage.toFixed(1)} ·
                  S {summaryRows[0].scoreBreakdown.signalClarity.toFixed(1)}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mb-2 text-[10px] text-black/45 dark:text-white/50">
            {t(
              'Target summary uses all-news baseline + Top5 key-event enhancement (50/50).',
              '标的汇总 = 全量新闻基线 + Top5关键事件增强（50/50 权重）。',
            )}
          </div>

          {!loading && summaryRows.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-black/50 dark:text-white/50">
              {t('No summary available.', '暂无可汇总标的。')}
            </div>
          ) : (
            <div className="rounded-xl border border-light-200/50 dark:border-dark-200/50 overflow-hidden">
              <div className="max-h-[540px] overflow-y-auto">
                <table className="w-full table-fixed text-[11px] leading-5">
                  <thead className="sticky top-0 bg-light-primary/90 dark:bg-dark-primary/90 backdrop-blur">
                    <tr className="text-black/50 dark:text-white/50">
                      <th className="text-left py-1.5 pl-2 w-8">#</th>
                      <th className="text-left py-1.5 pr-1 w-[104px]">{t('Concept', '概念')}</th>
                      <th className="text-left py-1.5 pr-1 w-[54px]">{t('Direction', '方向')}</th>
                      <th className="text-right py-1.5 pr-1 w-[58px]">{t('Score', '综合分')}</th>
                      <th className="text-right py-1.5 pr-1 w-10">C</th>
                      <th className="text-right py-1.5 pr-1 w-10">S</th>
                      <th className="text-right py-1.5 pr-1 w-12">{t('Bias', '偏向')}</th>
                      <th className="text-right py-1.5 pr-2 w-10">{t('N', 'N')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-light-200/40 dark:divide-dark-200/40">
                    {summaryRows.slice(0, 80).map((row, idx) => (
                      <tr key={row.target}>
                        <td className="py-1.5 pl-2">
                          <span
                            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                              idx < 3
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'text-black/45 dark:text-white/50'
                            }`}
                          >
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-1.5 pr-1 text-black/80 dark:text-white/85">
                          <div className="truncate" title={row.target}>
                            {row.target}
                          </div>
                        </td>
                        <td className="py-1.5 pr-1">
                          <span
                            className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${dirBadgeClass(row.direction)}`}
                          >
                            {dirText(row.direction, language)}
                          </span>
                        </td>
                        <td className="py-1.5 pr-1 text-right font-semibold text-cyan-700 dark:text-cyan-300">
                          {row.compositeScore.toFixed(1)}
                        </td>
                        <td className="py-1.5 pr-1 text-right text-black/65 dark:text-white/70">
                          {(row.confidence * 100).toFixed(0)}
                        </td>
                        <td className="py-1.5 pr-1 text-right text-black/65 dark:text-white/70">
                          {row.scoreBreakdown.signalClarity.toFixed(0)}
                        </td>
                        <td className="py-1.5 pr-1 text-right text-[10px]">
                          {(() => {
                            const net = row.positiveWeight - row.negativeWeight;
                            const txt = `${net >= 0 ? '+' : ''}${net.toFixed(1)}`;
                            const cls =
                              net >= 0.6
                                ? 'text-red-600 dark:text-red-400'
                                : net <= -0.6
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400';
                            return <span className={cls}>{txt}</span>;
                          })()}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-black/60 dark:text-white/65">
                          {row.eventCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-gradient-to-br from-light-secondary/70 via-light-primary/60 to-light-secondary/45 dark:from-dark-secondary/70 dark:via-dark-primary/55 dark:to-dark-secondary/45 p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-black/75 dark:text-white/80">
              {t('Fund Recommendations & Risk Prompts', '行业/风格基金推荐与风险提示')}
            </h2>
            <div className="text-[11px] text-black/45 dark:text-white/45">
              {t('Concepts', '概念数')}: {fundRecommendationPanel.length}
            </div>
          </div>

          <div className="text-[11px] text-black/50 dark:text-white/50 mb-2">
            {t(
              'Only bullish/bearish concepts are shown. Max 10 concepts and max 2 funds per concept.',
              '仅展示利多/利空概念，不展示分化；最多10个概念，每个概念最多2只基金。',
            )}
          </div>

          {!loading && fundRecommendationPanel.length === 0 ? (
            <div className="py-6 text-center text-[11px] text-black/50 dark:text-white/50">
              {t('No fund actions available.', '暂无基金动作建议。')}
            </div>
          ) : (
            <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
              {fundRecommendationPanel.slice(0, 10).map((row) => (
                <div
                  key={row.target}
                  className={`rounded-xl border p-2.5 ${dirSurfaceClass(row.direction)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-black/85 dark:text-white/90 truncate">
                        {row.target}
                      </div>
                      <div className="text-[10px] text-black/45 dark:text-white/50 mt-0.5">
                        {t('Events', '事件数')}: {row.eventCount}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${dirBadgeClass(row.direction)}`}
                      >
                        {dirText(row.direction, language)}
                      </div>
                      <div className="mt-1 text-[10px] text-cyan-700 dark:text-cyan-300">
                        {(row.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {row.funds.slice(0, 2).map((fund) => (
                      <div
                        key={`${row.target}-${fund.tsCode}`}
                        className="rounded-lg border border-light-200/55 dark:border-dark-200/55 bg-light-secondary/45 dark:bg-dark-secondary/40 px-2 py-1.5"
                      >
                        <div className="text-[11px] font-medium text-black/82 dark:text-white/85">
                          {fund.name} ({fund.tsCode})
                        </div>
                        <div className="text-[10px] text-black/50 dark:text-white/55 mt-0.5">
                          {fund.riskLevel || '-'} · {fund.reason}
                        </div>
                        <div className="text-[10px] text-black/50 dark:text-white/55 mt-0.5">
                          {fund.riskPrompt}
                        </div>
                      </div>
                    ))}
                    {row.funds.length === 0 ? (
                      <div className="text-[10px] text-black/50 dark:text-white/55">
                        {t(
                          'No highly aligned funds were selected for this concept.',
                          '该概念暂无高匹配基金，建议观察后再决策。',
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-2 text-[11px] text-black/62 dark:text-white/65">
                    {row.direction === 'negative'
                      ? `${t('Risk focus', '风险优先')}: ${row.riskHint}`
                      : `${t('Recommendation', '推荐逻辑')}: ${row.riskHint}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventImpactPage;
