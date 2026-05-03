'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClientLanguage } from '@/lib/hooks/useClientLanguage';

type FundRecommendationItem = {
  tsCode: string;
  name: string;
  riskLevel: string;
  reason: string;
};

type AssetAllocationBucket = {
  assetClass: string;
  weight: number;
  fund: FundRecommendationItem | null;
  note: string;
};

type AssetAllocationPlan = {
  name: string;
  profile: '进攻' | '均衡' | '防守';
  expectedScenario: string;
  buckets: AssetAllocationBucket[];
};

type AssetAllocationView = {
  outlook: '偏进攻' | '均衡' | '偏防守';
  confidence: number;
  marketView: string;
  reasoning: string;
  llmGenerated: boolean;
  providerId?: string;
  model?: string;
  plans: AssetAllocationPlan[];
};

type ApiResponse = {
  ok: boolean;
  assetAllocation?: AssetAllocationView;
  assetAllocationMeta?: {
    mode: 'llm' | 'rule-fallback';
    providerId?: string;
    model?: string;
    reason?: string;
  };
};

const REFRESH_MS = 6 * 60 * 60 * 1000;

const profileTheme = (profile: '进攻' | '均衡' | '防守') => {
  if (profile === '进攻') {
    return {
      tab: 'bg-rose-500/15 border-rose-500/40 text-rose-800 dark:text-rose-200',
      bar: 'bg-gradient-to-r from-rose-500 to-orange-500',
      badge: 'text-rose-700 dark:text-rose-300',
      surface:
        'border-rose-300/35 dark:border-rose-400/25 bg-gradient-to-br from-rose-50/85 via-orange-50/70 to-white/70 dark:from-rose-900/20 dark:via-orange-900/10 dark:to-dark-secondary/70',
      metric:
        'border-rose-300/30 dark:border-rose-400/25 bg-rose-50/75 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200',
      tableHead: 'bg-rose-50/70 dark:bg-rose-900/15',
    };
  }
  if (profile === '防守') {
    return {
      tab: 'bg-blue-500/15 border-blue-500/40 text-blue-800 dark:text-blue-200',
      bar: 'bg-gradient-to-r from-blue-500 to-cyan-500',
      badge: 'text-blue-700 dark:text-blue-300',
      surface:
        'border-blue-300/35 dark:border-blue-400/25 bg-gradient-to-br from-blue-50/85 via-cyan-50/70 to-white/70 dark:from-blue-900/20 dark:via-cyan-900/10 dark:to-dark-secondary/70',
      metric:
        'border-blue-300/30 dark:border-blue-400/25 bg-blue-50/75 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200',
      tableHead: 'bg-blue-50/70 dark:bg-blue-900/15',
    };
  }
  return {
    tab: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-800 dark:text-cyan-200',
    bar: 'bg-gradient-to-r from-cyan-500 to-teal-500',
    badge: 'text-cyan-700 dark:text-cyan-300',
    surface:
      'border-cyan-300/35 dark:border-cyan-400/25 bg-gradient-to-br from-cyan-50/85 via-teal-50/65 to-white/70 dark:from-cyan-900/20 dark:via-teal-900/10 dark:to-dark-secondary/70',
    metric:
      'border-cyan-300/30 dark:border-cyan-400/25 bg-cyan-50/75 dark:bg-cyan-900/20 text-cyan-800 dark:text-cyan-200',
    tableHead: 'bg-cyan-50/70 dark:bg-cyan-900/15',
  };
};

const bucketTone = (assetClass: string) => {
  const text = assetClass.toLowerCase();
  if (/固收|债|现金|战术/.test(text)) {
    return 'text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/20';
  }
  if (/黄金|商品|避险/.test(text)) {
    return 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/20';
  }
  if (/海外|港股|美股|qdii/.test(text)) {
    return 'text-violet-700 dark:text-violet-300 bg-violet-500/10 border-violet-500/20';
  }
  return 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
};

const AllocationPage = () => {
  const language = useClientLanguage('zh');
  const [loading, setLoading] = useState(true);
  const [allocation, setAllocation] = useState<AssetAllocationView | null>(null);
  const [allocationMeta, setAllocationMeta] = useState<ApiResponse['assetAllocationMeta'] | null>(
    null,
  );
  const [activePlan, setActivePlan] = useState(0);

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/finance/event-impact?limit=10', {
          cache: 'no-store',
        });
        const data = (await res.json()) as ApiResponse;
        if (!res.ok || !data.ok || !data.assetAllocation) {
          throw new Error('asset allocation unavailable');
        }
        if (!active) return;
        setAllocation(data.assetAllocation);
        setAllocationMeta(data.assetAllocationMeta || null);
        setActivePlan(0);
      } catch (err) {
        console.error('Failed to load asset allocation', err);
        if (!active) return;
        setAllocation(null);
        setAllocationMeta(null);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    };

    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const currentPlan = useMemo(() => {
    if (!allocation?.plans?.length) return null;
    return allocation.plans[Math.min(activePlan, allocation.plans.length - 1)] || null;
  }, [allocation, activePlan]);
  const currentTheme = currentPlan ? profileTheme(currentPlan.profile) : profileTheme('均衡');

  const currentPlanStats = useMemo(() => {
    if (!currentPlan) return null;
    let equity = 0;
    let defense = 0;
    currentPlan.buckets.forEach((b) => {
      if (/权益|主题|海外/.test(b.assetClass)) equity += b.weight;
      if (/固收|债|黄金|低波|现金|战术/.test(b.assetClass)) defense += b.weight;
    });
    return {
      bucketCount: currentPlan.buckets.length,
      equityWeight: equity,
      defenseWeight: defense,
    };
  }, [currentPlan]);

  return (
    <div className="pt-6 pb-6">
      <div className="mb-5 flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-black/90 dark:text-white/90">
          {t('Asset Allocation', '资产配置')}
        </h1>
        <p className="text-[11px] text-black/55 dark:text-white/55">
          {t(
            'Professional multi-scenario portfolio construction based on event-driven market view and fund mapping.',
            '基于事件驱动市场观点与基金映射，生成多情景资产配置方案。',
          )}
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/60 dark:bg-dark-secondary/60 py-14 text-center text-sm text-black/55 dark:text-white/55">
          {t('Loading allocation model...', '正在生成配置方案...')}
        </div>
      ) : !allocation ? (
        <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/60 dark:bg-dark-secondary/60 py-14 text-center text-sm text-black/55 dark:text-white/55">
          {t('Allocation data unavailable.', '暂未获取到资产配置数据。')}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-cyan-300/30 dark:border-cyan-300/25 bg-gradient-to-br from-cyan-50/80 to-white/70 dark:from-cyan-900/20 dark:to-dark-secondary/80 p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/70 dark:bg-dark-primary/60 p-3">
                <div className="text-[11px] text-black/50 dark:text-white/50">{t('Market Outlook', '市场观点')}</div>
                <div className="text-sm font-semibold text-black/85 dark:text-white/90 mt-1">{allocation.outlook}</div>
              </div>
              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/70 dark:bg-dark-primary/60 p-3">
                <div className="text-[11px] text-black/50 dark:text-white/50">{t('Confidence', '置信度')}</div>
                <div className="text-sm font-semibold text-black/85 dark:text-white/90 mt-1">
                  {(allocation.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-xl border border-light-200/60 dark:border-dark-200/60 bg-light-primary/70 dark:bg-dark-primary/60 p-3">
                <div className="text-[11px] text-black/50 dark:text-white/50">{t('Model', '模型来源')}</div>
                <div className="text-sm font-semibold text-black/85 dark:text-white/90 mt-1">
                  {allocation.llmGenerated
                    ? `${allocation.providerId || '-'} / ${allocation.model || '-'}`
                    : t('Rules fallback', '规则回退')}
                </div>
              </div>
            </div>

            {allocationMeta?.mode === 'rule-fallback' ? (
              <div className="mb-3 rounded-xl border border-amber-300/35 dark:border-amber-400/25 bg-amber-50/70 dark:bg-amber-900/15 p-2.5 text-[11px] text-amber-800 dark:text-amber-200">
                {t('LLM unavailable, using rule fallback.', '检测到大模型不可用，已自动回退到规则引擎。')}
                {allocationMeta.reason ? ` (${allocationMeta.reason})` : ''}
              </div>
            ) : null}

            <div className="rounded-xl border border-light-200/50 dark:border-dark-200/50 bg-light-secondary/65 dark:bg-dark-secondary/65 p-3">
              <div className="text-xs font-medium text-black/80 dark:text-white/85 mb-1">{allocation.marketView}</div>
              <div className="text-[11px] text-black/55 dark:text-white/60">{allocation.reasoning}</div>
            </div>
          </div>

          <div className={`rounded-2xl border p-3 ${currentTheme.surface}`}>
            <div className="flex flex-wrap gap-2 mb-3">
              {allocation.plans.map((plan, idx) => (
                <button
                  key={plan.name}
                  type="button"
                  onClick={() => setActivePlan(idx)}
                  aria-pressed={idx === activePlan}
                  className={`rounded-xl px-3 py-2.5 text-xs border transition ${
                    idx === activePlan
                      ? profileTheme(plan.profile).tab
                      : 'bg-light-primary/60 dark:bg-dark-primary/50 border-light-200 dark:border-dark-200 text-black/70 dark:text-white/70'
                  }`}
                >
                  <span className="font-semibold">{plan.name}</span>
                  <span className={`ml-1 text-[10px] opacity-90 ${profileTheme(plan.profile).badge}`}>
                    {plan.profile}
                  </span>
                </button>
              ))}
            </div>

            {currentPlan ? (
              <>
                <div className="mb-3 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-2">
                  <div className="rounded-xl border border-light-200/50 dark:border-dark-200/50 bg-light-primary/65 dark:bg-dark-primary/45 p-3">
                    <div className="text-[11px] text-black/50 dark:text-white/50">{t('Scenario', '适用情景')}</div>
                    <div className="text-xs text-black/80 dark:text-white/85 mt-1">{currentPlan.expectedScenario}</div>
                  </div>
                  <div
                    className={`rounded-xl border px-3 py-2.5 min-w-[92px] ${currentTheme.metric}`}
                  >
                    <div className="text-[10px] opacity-75">{t('Buckets', '资产桶')}</div>
                    <div className="text-sm font-semibold">{currentPlanStats?.bucketCount || 0}</div>
                  </div>
                  <div
                    className={`rounded-xl border px-3 py-2.5 min-w-[92px] ${currentTheme.metric}`}
                  >
                    <div className="text-[10px] opacity-75">{t('Equity', '权益仓')}</div>
                    <div className="text-sm font-semibold">{currentPlanStats?.equityWeight || 0}%</div>
                  </div>
                  <div
                    className={`rounded-xl border px-3 py-2.5 min-w-[92px] ${currentTheme.metric}`}
                  >
                    <div className="text-[10px] opacity-75">{t('Defense', '防守仓')}</div>
                    <div className="text-sm font-semibold">{currentPlanStats?.defenseWeight || 0}%</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-3">
                  <div className="rounded-xl border border-light-200/50 dark:border-dark-200/50 bg-light-primary/65 dark:bg-dark-primary/45 p-3">
                    <div className="text-xs font-semibold text-black/80 dark:text-white/85 mb-2">
                      {t('Weight Structure', '权重结构')}
                    </div>
                    <div className="space-y-2.5">
                      {currentPlan.buckets.map((bucket) => (
                        <div key={bucket.assetClass}>
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="text-black/70 dark:text-white/75">{bucket.assetClass}</span>
                            <span className="font-semibold text-black/85 dark:text-white/85">{bucket.weight}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${profileTheme(currentPlan.profile).bar}`}
                              style={{ width: `${bucket.weight}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-light-200/50 dark:border-dark-200/50 overflow-x-auto bg-light-primary/55 dark:bg-dark-primary/35">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className={`text-[11px] text-black/55 dark:text-white/55 ${currentTheme.tableHead}`}>
                          <th className="text-left py-2 px-2.5 min-w-[82px]">{t('Bucket', '资产桶')}</th>
                          <th className="text-right py-2 px-2.5 min-w-[62px]">{t('Weight', '权重')}</th>
                          <th className="text-left py-2 px-2.5 min-w-[200px]">{t('Fund Candidate', '候选基金')}</th>
                          <th className="text-left py-2 px-2.5 min-w-[200px]">{t('Notes', '配置说明')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-light-200/40 dark:divide-dark-200/40">
                        {currentPlan.buckets.map((bucket) => (
                          <tr key={bucket.assetClass}>
                            <td className="py-2 px-2.5 text-black/80 dark:text-white/85">
                              <span
                                className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${bucketTone(bucket.assetClass)}`}
                              >
                                {bucket.assetClass}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-right font-semibold text-black/80 dark:text-white/85">
                              {bucket.weight}%
                            </td>
                            <td className="py-2 px-2.5 text-black/70 dark:text-white/75">
                              {bucket.fund ? (
                                <>
                                  <div className="font-medium text-black/85 dark:text-white/85">
                                    {bucket.fund.name} ({bucket.fund.tsCode})
                                  </div>
                                  <div className="text-[10px] text-black/50 dark:text-white/55 mt-0.5 leading-4">
                                    {bucket.fund.riskLevel} · {bucket.fund.reason}
                                  </div>
                                </>
                              ) : (
                                <span className="text-black/50 dark:text-white/55">{t('No mapped fund', '暂无可映射基金')}</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5 text-[11px] leading-5 text-black/65 dark:text-white/70">{bucket.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default AllocationPage;
