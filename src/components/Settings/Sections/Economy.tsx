import { UIConfigField } from '@/lib/config/types';
import SettingsField from '../SettingsField';
import { toast } from 'sonner';
import { useEffect, useMemo, useRef, useState } from 'react';

type CacheModuleKey = 'news_finance' | 'economy_news' | 'discover' | 'event_impact';
type CacheInvalidateScope = CacheModuleKey | 'all';
type SlowWindowHours = '6' | '24' | '168';
type CacheTrendPoint = {
  slot: string;
  ts: number;
  requests: number;
  hits: number;
  misses: number;
  hitRate: number;
  recomputeAvgMs: number;
  recomputeMaxMs: number;
};

type CacheSlotRow = {
  slot: string;
  requests: number;
  hits: number;
  misses: number;
  hitRate: number;
  recomputeAvgMs: number;
  recomputeMaxMs: number;
  sampleSizeLast: number;
  updatedAt: number;
};

type CacheModuleObservability = {
  currentSlot: string;
  totalRequests: number;
  totalHits: number;
  totalMisses: number;
  totalHitRate: number;
  slots: CacheSlotRow[];
};

type CacheObservabilityResponse = {
  ok: boolean;
  updatedAt?: number;
  thresholds?: {
    hitRateWarn?: number;
    recomputeAvgWarnMs?: number;
    recomputeMaxWarnMs?: number;
  };
  modules?: Record<CacheModuleKey, CacheModuleObservability>;
  trendSeries?: Partial<Record<CacheModuleKey, CacheTrendPoint[]>>;
  slowRecomputeTop?: Array<{
    module: CacheModuleKey;
    slot: string;
    recomputeAvgMs: number;
    recomputeMaxMs: number;
    misses: number;
    sampleSizeLast: number;
  }>;
};

const MODULE_LABELS: Record<CacheModuleKey, string> = {
  news_finance: '财经新闻',
  economy_news: '经济新闻',
  discover: '发现页',
  event_impact: '事件驱动',
};

const MODULE_ORDER: CacheModuleKey[] = [
  'news_finance',
  'economy_news',
  'discover',
  'event_impact',
];

const ADMIN_TOKEN_STORAGE_KEY = 'cache-admin-token';
const DEFAULT_THRESHOLDS = {
  hitRateWarn: 55,
  recomputeAvgWarnMs: 15000,
  recomputeMaxWarnMs: 30000,
};

const buildSparklinePoints = (
  values: number[],
  width = 140,
  height = 32,
  padding = 2,
) => {
  if (!values.length) return '';
  if (values.length === 1) {
    const y = height / 2;
    return `${padding},${y.toFixed(1)} ${width - padding},${y.toFixed(1)}`;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1e-6, max - min);
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);

  return values
    .map((v, idx) => {
      const x = padding + (idx / (values.length - 1)) * usableW;
      const y = padding + ((max - v) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
};

const Economy = ({
  fields,
  values,
}: {
  fields: UIConfigField[];
  values: Record<string, any>;
}) => {
  const [observability, setObservability] =
    useState<CacheObservabilityResponse | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  const [obsBusy, setObsBusy] = useState(false);
  const [invalidateBusy, setInvalidateBusy] = useState(false);
  const [invalidateScope, setInvalidateScope] =
    useState<CacheInvalidateScope>('event_impact');
  const [rewarm, setRewarm] = useState(true);
  const [adminToken, setAdminToken] = useState('');
  const [slowModuleFilter, setSlowModuleFilter] = useState<CacheInvalidateScope>('all');
  const [slowWindowHours, setSlowWindowHours] = useState<SlowWindowHours>('24');
  const invalidatePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
    setAdminToken(saved);
  }, []);

  const saveTokenLocal = (value: string) => {
    if (typeof window === 'undefined') return;
    if (value.trim()) window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, value.trim());
    else window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  };

  const loadObservability = async (silent = false) => {
    if (silent) setObsBusy(true);
    else setObsLoading(true);
    try {
      const query = new URLSearchParams({
        module: slowModuleFilter,
        windowHours: slowWindowHours,
        topN: '12',
      });
      const res = await fetch(`/api/cache/observability?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const json = (await res.json()) as CacheObservabilityResponse;
      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.message || `HTTP ${res.status}`);
      }
      setObservability(json);
    } catch (err: any) {
      toast.error(`缓存观测读取失败：${err?.message || 'unknown error'}`);
    } finally {
      setObsLoading(false);
      setObsBusy(false);
    }
  };

  useEffect(() => {
    void loadObservability();
    const timer = setInterval(() => {
      void loadObservability(true);
    }, 60_000);
    return () => clearInterval(timer);
  }, [slowModuleFilter, slowWindowHours]);

  const invalidateCache = async () => {
    setInvalidateBusy(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (adminToken.trim()) {
        headers['x-admin-token'] = adminToken.trim();
      }

      const res = await fetch('/api/cache/invalidate', {
        method: 'POST',
        cache: 'no-store',
        headers,
        body: JSON.stringify({ scope: invalidateScope, rewarm }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('鉴权失败：请检查 ADMIN_ACCESS_TOKEN 与输入 token');
        }
        throw new Error(json?.message || `HTTP ${res.status}`);
      }

      const deletedCount = Array.isArray(json?.deletedFiles) ? json.deletedFiles.length : 0;
      const warmCount = Array.isArray(json?.warmResults) ? json.warmResults.length : 0;
      toast.success(
        `缓存已失效（scope=${json?.scope || invalidateScope}，删除 ${deletedCount} 个文件，预热 ${warmCount} 个端点）`,
      );
      await loadObservability(true);
    } catch (err: any) {
      toast.error(`缓存失效失败：${err?.message || 'unknown error'}`);
    } finally {
      setInvalidateBusy(false);
    }
  };

  const validateToken = async () => {
    try {
      const res = await fetch('/api/economy/tushare/validate', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const json = (await res.json()) as any;
      if (json?.ok) {
        toast.success('TuShare token 校验通过');
        return;
      }

      const code = json?.code;
      const msg = json?.message || '校验失败';

      if (json?.reason === 'missing_token') {
        toast.error('未配置 TuShare token');
        return;
      }
      if (json?.reason === 'invalid_token') {
        toast.error(`TuShare token 无效（${code ?? ''}）${msg}`);
        return;
      }
      if (json?.reason === 'no_permission') {
        toast.error(`TuShare 无接口权限（${code ?? ''}）${msg}`);
        return;
      }

      toast.error(`TuShare 校验失败（${code ?? ''}）${msg}`);
    } catch (err: any) {
      toast.error(err?.message ?? '校验失败');
    }
  };

  const validateOpenbbMcp = async () => {
    try {
      const res = await fetch('/api/economy/openbb/validate', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const json = (await res.json()) as any;

      if (json?.ok) {
        const preview = Array.isArray(json?.tools)
          ? json.tools.slice(0, 5).join(', ')
          : '';
        const routerHint =
          json?.hasMarketRouter === false
            ? '；未检测到 market-router prompt'
            : '';
        toast.success(
          preview
            ? `OpenBB MCP 连通成功，已发现工具：${preview}${routerHint}`
            : `OpenBB MCP 连通成功${routerHint}`,
        );
        return;
      }

      if (json?.reason === 'disabled') {
        toast.error('OpenBB MCP 未启用，请先打开开关');
        return;
      }
      if (json?.reason === 'missing_url') {
        toast.error('请先配置 OpenBB MCP URL');
        return;
      }
      if (json?.reason === 'no_tools') {
        toast.error('OpenBB MCP 连通但未发现可用工具');
        return;
      }

      toast.error(json?.message ?? 'OpenBB MCP 校验失败');
    } catch (err: any) {
      toast.error(err?.message ?? 'OpenBB MCP 校验失败');
    }
  };

  const validateMiniMaxMcp = async () => {
    try {
      const res = await fetch('/api/economy/minimax/validate', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const json = (await res.json()) as any;

      if (json?.ok) {
        const capability = json?.capabilities || {};
        const caps = [
          capability?.webSearch ? 'web_search' : '',
          capability?.understandImage ? 'understand_image' : '',
          capability?.imageGeneration ? 'text_to_image' : '',
        ]
          .filter(Boolean)
          .join(' / ');

        const tools = Array.isArray(json?.tools)
          ? json.tools.slice(0, 5).join(', ')
          : '';

        toast.success(
          caps
            ? `MiniMax MCP 连通成功，可用能力：${caps}${tools ? `；工具示例：${tools}` : ''}`
            : `MiniMax MCP 连通成功${tools ? `；工具示例：${tools}` : ''}`,
        );
        return;
      }

      if (json?.reason === 'disabled') {
        toast.error('MiniMax MCP 未启用，请先打开开关');
        return;
      }
      if (json?.reason === 'missing_url') {
        toast.error('请先配置 MiniMax MCP URL');
        return;
      }
      if (json?.reason === 'no_tools') {
        toast.error('MiniMax MCP 连通但未发现可用工具');
        return;
      }

      toast.error(json?.message ?? 'MiniMax MCP 校验失败');
    } catch (err: any) {
      toast.error(err?.message ?? 'MiniMax MCP 校验失败');
    }
  };

  const moduleRows = useMemo(() => {
    const thresholds = {
      hitRateWarn: Number(observability?.thresholds?.hitRateWarn || DEFAULT_THRESHOLDS.hitRateWarn),
      recomputeAvgWarnMs: Number(
        observability?.thresholds?.recomputeAvgWarnMs || DEFAULT_THRESHOLDS.recomputeAvgWarnMs,
      ),
      recomputeMaxWarnMs: Number(
        observability?.thresholds?.recomputeMaxWarnMs || DEFAULT_THRESHOLDS.recomputeMaxWarnMs,
      ),
    };
    const modules = observability?.modules;
    const trendSeries = observability?.trendSeries || {};
    if (!modules) return [];

    return MODULE_ORDER.map((key) => {
      const moduleData = modules[key];
      const latestSlot = moduleData?.slots?.[0];
      const trend = Array.isArray(trendSeries[key]) ? trendSeries[key]! : [];
      return {
        key,
        label: MODULE_LABELS[key],
        totalRequests: moduleData?.totalRequests || 0,
        totalHits: moduleData?.totalHits || 0,
        totalMisses: moduleData?.totalMisses || 0,
        totalHitRate: moduleData?.totalHitRate || 0,
        latestSlot,
        trend,
        hasHitRateAlert:
          Number(latestSlot?.hitRate || 0) > 0 &&
          Number(latestSlot?.hitRate || 0) < thresholds.hitRateWarn,
        hasRecomputeAlert:
          Number(latestSlot?.recomputeAvgMs || 0) >= thresholds.recomputeAvgWarnMs ||
          Number(latestSlot?.recomputeMaxMs || 0) >= thresholds.recomputeMaxWarnMs,
        hasTrendAlert: trend.some(
          (p) =>
            Number(p?.hitRate || 0) < thresholds.hitRateWarn ||
            Number(p?.recomputeAvgMs || 0) >= thresholds.recomputeAvgWarnMs,
        ),
      };
    });
  }, [observability]);

  const alertThresholds = useMemo(
    () => ({
      hitRateWarn: Number(
        observability?.thresholds?.hitRateWarn || DEFAULT_THRESHOLDS.hitRateWarn,
      ),
      recomputeAvgWarnMs: Number(
        observability?.thresholds?.recomputeAvgWarnMs || DEFAULT_THRESHOLDS.recomputeAvgWarnMs,
      ),
      recomputeMaxWarnMs: Number(
        observability?.thresholds?.recomputeMaxWarnMs || DEFAULT_THRESHOLDS.recomputeMaxWarnMs,
      ),
    }),
    [observability?.thresholds?.hitRateWarn, observability?.thresholds?.recomputeAvgWarnMs, observability?.thresholds?.recomputeMaxWarnMs],
  );

  const focusInvalidateByModule = (module: CacheModuleKey) => {
    setInvalidateScope(module);
    setSlowModuleFilter(module);
    setTimeout(() => {
      invalidatePanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 120);
  };

  const slowRecomputeRows = useMemo(() => {
    const fromApi = Array.isArray(observability?.slowRecomputeTop)
      ? observability!.slowRecomputeTop
      : [];
    if (fromApi.length) {
      return fromApi.slice(0, 8).map((row) => ({
        moduleKey: row.module,
        moduleLabel: MODULE_LABELS[row.module],
        slot: row.slot,
        recomputeAvgMs: Number(row.recomputeAvgMs || 0),
        recomputeMaxMs: Number(row.recomputeMaxMs || 0),
        misses: Number(row.misses || 0),
        sampleSizeLast: Number(row.sampleSizeLast || 0),
      }));
    }

    const modules = observability?.modules;
    if (!modules) return [];

    const flattened: Array<{
      moduleKey: CacheModuleKey;
      moduleLabel: string;
      slot: string;
      recomputeAvgMs: number;
      recomputeMaxMs: number;
      misses: number;
      sampleSizeLast: number;
    }> = [];

    for (const moduleKey of MODULE_ORDER) {
      const moduleData = modules[moduleKey];
      const slots = Array.isArray(moduleData?.slots) ? moduleData.slots : [];
      for (const row of slots) {
        const avg = Number(row.recomputeAvgMs || 0);
        const max = Number(row.recomputeMaxMs || 0);
        if (avg <= 0 && max <= 0) continue;

        flattened.push({
          moduleKey,
          moduleLabel: MODULE_LABELS[moduleKey],
          slot: row.slot,
          recomputeAvgMs: avg,
          recomputeMaxMs: max,
          misses: Number(row.misses || 0),
          sampleSizeLast: Number(row.sampleSizeLast || 0),
        });
      }
    }

    return flattened
      .sort((a, b) => {
        if (b.recomputeAvgMs !== a.recomputeAvgMs) {
          return b.recomputeAvgMs - a.recomputeAvgMs;
        }
        if (b.recomputeMaxMs !== a.recomputeMaxMs) {
          return b.recomputeMaxMs - a.recomputeMaxMs;
        }
        return b.misses - a.misses;
      })
      .slice(0, 8);
  }, [observability]);

  const updatedAtText = useMemo(() => {
    const ts = Number(observability?.updatedAt || 0);
    if (!ts) return '-';
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  }, [observability]);

  return (
    <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
      {fields.map((field) => (
        <SettingsField
          key={field.key}
          field={field}
          value={values[field.key] ?? field.default}
          dataAdd="economy"
        />
      ))}

      <div className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 transition-colors dark:border-dark-200 dark:bg-dark-primary/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm lg:text-sm text-black dark:text-white">
              校验 TuShare Token
            </h4>
            <p className="text-[11px] lg:text-xs text-black/50 dark:text-white/50">
              用于确认 token 是否有效，以及是否具备接口权限（不会泄露 token）。
            </p>
          </div>
          <button
            type="button"
            onClick={validateToken}
            className="inline-flex items-center gap-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 !text-xs text-black/70 dark:text-white/70 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition"
          >
            立即校验
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 transition-colors dark:border-dark-200 dark:bg-dark-primary/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm lg:text-sm text-black dark:text-white">
              校验 OpenBB MCP
            </h4>
            <p className="text-[11px] lg:text-xs text-black/50 dark:text-white/50">
              检查 OpenBB MCP 服务连通性并读取可用工具列表。
            </p>
          </div>
          <button
            type="button"
            onClick={validateOpenbbMcp}
            className="inline-flex items-center gap-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 !text-xs text-black/70 dark:text-white/70 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition"
          >
            立即校验
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 transition-colors dark:border-dark-200 dark:bg-dark-primary/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm lg:text-sm text-black dark:text-white">
              校验 MiniMax MCP
            </h4>
            <p className="text-[11px] lg:text-xs text-black/50 dark:text-white/50">
              检查 MiniMax MCP 连通性及三项能力：web_search / understand_image / text_to_image。
            </p>
          </div>
          <button
            type="button"
            onClick={validateMiniMaxMcp}
            className="inline-flex items-center gap-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 !text-xs text-black/70 dark:text-white/70 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition"
          >
            立即校验
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-light-200 bg-light-primary/80 p-4 lg:p-6 transition-colors dark:border-dark-200 dark:bg-dark-primary/80">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm lg:text-sm text-black dark:text-white">
              缓存可观测性面板
            </h4>
            <p className="text-[11px] lg:text-xs text-black/50 dark:text-white/50">
              查看各模块缓存命中率、重算耗时，并可手动失效+预热。最近更新时间：{updatedAtText}
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadObservability(true)}
            disabled={obsBusy || obsLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 !text-xs text-black/70 dark:text-white/70 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {obsBusy || obsLoading ? '刷新中…' : '刷新观测'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {moduleRows.map((row) => (
            <div
              key={row.key}
              className={
                row.hasHitRateAlert || row.hasRecomputeAlert
                  ? 'rounded-lg border border-amber-300/70 bg-amber-50/30 px-3 py-3 dark:border-amber-600/50 dark:bg-amber-900/10'
                  : 'rounded-lg border border-light-200/80 px-3 py-3 dark:border-dark-200/80'
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-black/80 dark:text-white/80">
                  {row.label}
                </span>
                <span className="text-[11px] text-black/45 dark:text-white/45">
                  命中率 {row.totalHitRate.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2 text-[11px] text-black/55 dark:text-white/55">
                请求 {row.totalRequests} / 命中 {row.totalHits} / 未命中 {row.totalMisses}
              </div>
              <div className="mt-1 text-[11px] text-black/45 dark:text-white/45">
                最新 slot：{row.latestSlot?.slot || '-'}，样本 {row.latestSlot?.sampleSizeLast || 0}，
                平均重算 {Number(row.latestSlot?.recomputeAvgMs || 0).toFixed(1)}ms
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {row.hasHitRateAlert && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                      命中率低于 {alertThresholds.hitRateWarn}%
                    </span>
                  )}
                  {row.hasRecomputeAlert && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
                      重算耗时偏高
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => focusInvalidateByModule(row.key)}
                  className="rounded border border-light-200 px-2 py-1 text-[10px] text-black/70 transition hover:bg-light-200/60 dark:border-dark-200 dark:text-white/70 dark:hover:bg-dark-200/60"
                >
                  定位失效
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-light-200/80 p-3 dark:border-dark-200/80">
          <div className="mb-2 text-xs font-medium text-black/80 dark:text-white/80">
            缓存趋势（slot 序列）
          </div>
          <p className="mb-3 text-[11px] text-black/45 dark:text-white/45">
            下方展示命中率与重算均值随 slot 的变化；筛选条件与“慢重算 Top”一致。
            告警阈值：命中率 {'<'} {alertThresholds.hitRateWarn}%、
            平均重算 {'>='} {alertThresholds.recomputeAvgWarnMs}ms、
            峰值重算 {'>='} {alertThresholds.recomputeMaxWarnMs}ms。
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {moduleRows.map((row) => {
              const trend = Array.isArray(row.trend) ? row.trend : [];
              const hitValues = trend.map((x) => Number(x.hitRate || 0));
              const recomputeValues = trend.map((x) => Number(x.recomputeAvgMs || 0));
              const hitPoints = buildSparklinePoints(hitValues);
              const recomputePoints = buildSparklinePoints(recomputeValues);
              const firstSlot = trend[0]?.slot || '-';
              const lastSlot = trend[trend.length - 1]?.slot || '-';
              const avgHitRate =
                hitValues.length > 0
                  ? hitValues.reduce((s, x) => s + x, 0) / hitValues.length
                  : 0;
              const avgRecomputeMs =
                recomputeValues.length > 0
                  ? recomputeValues.reduce((s, x) => s + x, 0) / recomputeValues.length
                  : 0;

              return (
                <div
                  key={`trend-${row.key}`}
                  className={
                    row.hasTrendAlert
                      ? 'rounded-lg border border-amber-300/70 bg-amber-50/20 p-2 dark:border-amber-600/40 dark:bg-amber-900/10'
                      : 'rounded-lg border border-light-200/70 p-2 dark:border-dark-200/70'
                  }
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-black/80 dark:text-white/80">
                      {row.label}
                    </span>
                    <span className="text-[10px] text-black/45 dark:text-white/45">
                      {trend.length} 点
                    </span>
                  </div>
                  {trend.length === 0 ? (
                    <p className="text-[11px] text-black/45 dark:text-white/45">
                      当前筛选窗口无趋势数据。
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {row.hasTrendAlert && (
                        <div className="text-[10px] text-amber-700 dark:text-amber-300">
                          告警：窗口内出现低命中或高耗时点
                        </div>
                      )}
                      <div className="text-[10px] text-black/45 dark:text-white/45">
                        命中率均值 {avgHitRate.toFixed(1)}%
                      </div>
                      <svg width="100%" height="32" viewBox="0 0 140 32" className="block">
                        <polyline
                          points={hitPoints}
                          fill="none"
                          stroke="rgba(56,189,248,0.95)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <div className="text-[10px] text-black/45 dark:text-white/45">
                        重算均值 {avgRecomputeMs.toFixed(1)}ms
                      </div>
                      <svg width="100%" height="32" viewBox="0 0 140 32" className="block">
                        <polyline
                          points={recomputePoints}
                          fill="none"
                          stroke="rgba(244,114,182,0.95)"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <div className="text-[10px] text-black/40 dark:text-white/40">
                        {firstSlot} {'->'} {lastSlot}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-light-200/80 p-3 dark:border-dark-200/80">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-black/80 dark:text-white/80">
              慢重算 Top（按平均重算耗时）
            </div>
            <div className="flex items-center gap-2">
              <select
                value={slowModuleFilter}
                onChange={(e) => setSlowModuleFilter(e.target.value as CacheInvalidateScope)}
                className="rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-2 py-1 text-[11px] text-black/80 dark:text-white/80"
              >
                <option value="all">全部模块</option>
                <option value="event_impact">事件驱动</option>
                <option value="discover">发现页</option>
                <option value="news_finance">财经新闻</option>
                <option value="economy_news">经济新闻</option>
              </select>
              <select
                value={slowWindowHours}
                onChange={(e) => setSlowWindowHours(e.target.value as SlowWindowHours)}
                className="rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-2 py-1 text-[11px] text-black/80 dark:text-white/80"
              >
                <option value="6">近 6 小时</option>
                <option value="24">近 24 小时</option>
                <option value="168">近 7 天</option>
              </select>
            </div>
          </div>
          {slowRecomputeRows.length === 0 ? (
            <p className="text-[11px] text-black/45 dark:text-white/45">
              暂无重算样本（全部命中缓存或尚未产生未命中请求）。
            </p>
          ) : (
            <div className="space-y-1">
              {slowRecomputeRows.map((row, idx) => (
                <div
                  key={`${row.moduleKey}-${row.slot}-${idx}`}
                  className="grid grid-cols-12 gap-2 text-[11px] text-black/70 dark:text-white/70"
                >
                  <span className="col-span-1 text-black/45 dark:text-white/45">
                    {idx + 1}
                  </span>
                  <span className="col-span-3 truncate">{row.moduleLabel}</span>
                  <span className="col-span-3 truncate text-black/45 dark:text-white/45">
                    {row.slot}
                  </span>
                  <span className="col-span-2 text-right">
                    平均 {row.recomputeAvgMs.toFixed(1)}ms
                  </span>
                  <span className="col-span-2 text-right">
                    峰值 {row.recomputeMaxMs.toFixed(1)}ms
                  </span>
                  <span className="col-span-1 text-right text-black/45 dark:text-white/45">
                    miss {row.misses}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          ref={invalidatePanelRef}
          className="mt-4 rounded-lg border border-light-200/80 p-3 dark:border-dark-200/80"
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="lg:col-span-3">
              <label className="mb-1 block text-[11px] text-black/50 dark:text-white/50">
                失效范围
              </label>
              <select
                value={invalidateScope}
                onChange={(e) => setInvalidateScope(e.target.value as CacheInvalidateScope)}
                className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 text-xs text-black/80 dark:text-white/80"
              >
                <option value="event_impact">事件驱动</option>
                <option value="discover">发现页</option>
                <option value="news_finance">财经新闻</option>
                <option value="economy_news">经济新闻</option>
                <option value="all">全部缓存</option>
              </select>
            </div>

            <div className="lg:col-span-4">
              <label className="mb-1 block text-[11px] text-black/50 dark:text-white/50">
                管理员 Token（可选）
              </label>
              <input
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                onBlur={(e) => saveTokenLocal(e.target.value)}
                placeholder="仅当服务端设置 ADMIN_ACCESS_TOKEN 时需要"
                className="w-full rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 text-xs text-black/80 dark:text-white/80 placeholder:text-black/35 dark:placeholder:text-white/35"
              />
            </div>

            <div className="lg:col-span-2 flex items-end">
              <label className="inline-flex items-center gap-2 text-xs text-black/70 dark:text-white/70">
                <input
                  type="checkbox"
                  checked={rewarm}
                  onChange={(e) => setRewarm(e.target.checked)}
                  className="h-4 w-4 rounded border-light-200 dark:border-dark-200"
                />
                失效后预热
              </label>
            </div>

            <div className="lg:col-span-3 flex items-end">
              <button
                type="button"
                disabled={invalidateBusy}
                onClick={invalidateCache}
                className="w-full inline-flex items-center justify-center rounded-lg border border-light-200 dark:border-dark-200 bg-light-primary dark:bg-dark-primary px-3 py-2 text-xs text-black/80 dark:text-white/80 hover:bg-light-200/60 dark:hover:bg-dark-200/60 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {invalidateBusy ? '处理中…' : '执行失效'}
              </button>
            </div>
          </div>
        </div>

        {obsLoading && (
          <p className="mt-3 text-[11px] text-black/45 dark:text-white/45">缓存观测加载中...</p>
        )}
      </div>
    </div>
  );
};

export default Economy;
