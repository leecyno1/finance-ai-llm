#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const res = await fetch(`${baseUrl}/api/finance/event-impact?limit=120`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const fundRecommendations = Array.isArray(data.fundRecommendations)
    ? data.fundRecommendations
    : null;
  const assetAllocation = data.assetAllocation || null;

  const errors = [];
  const normalize = (v) => String(v || '').toLowerCase();
  const fundText = (fund) =>
    normalize(
      [
        fund?.name,
        fund?.style,
        fund?.category,
      ].join(' '),
    );
  const isBondLike = (fund) => /债|固收|中债|国债|信用债|短债|中短债|货币|现金/.test(fundText(fund));
  const isGoldLike = (fund) => /黄金|贵金属|上海金|商品/.test(fundText(fund));
  const isOverseasLike = (fund) => /qdii|海外|美股|港股|纳斯达克|标普|恒生/.test(fundText(fund));
  const isLowVolLike = (fund) => /红利|低波|股息|价值|稳健/.test(fundText(fund));
  const isEquityLike = (fund) => /股票|权益|指数|etf|成长|科技|中证|沪深300|混合/.test(fundText(fund));

  if (!fundRecommendations || !fundRecommendations.length) {
    errors.push('missing fundRecommendations');
  }

  if (!assetAllocation || !Array.isArray(assetAllocation.plans) || !assetAllocation.plans.length) {
    errors.push('missing assetAllocation plans');
  }

  if (fundRecommendations && fundRecommendations.length) {
    const sample = fundRecommendations[0];
    if (!Array.isArray(sample.funds) || !sample.funds.length) {
      errors.push('fundRecommendations[0].funds empty');
    }
    if (!sample.riskHint || typeof sample.riskHint !== 'string') {
      errors.push('fundRecommendations[0].riskHint missing');
    }
  }

  if (assetAllocation && Array.isArray(assetAllocation.plans) && assetAllocation.plans.length) {
    const bucketCount = assetAllocation.plans.reduce(
      (acc, p) => acc + (Array.isArray(p.buckets) ? p.buckets.length : 0),
      0,
    );
    if (bucketCount === 0) {
      errors.push('assetAllocation buckets empty');
    }

    const allSelectedCodes = new Set();
    for (const plan of assetAllocation.plans) {
      for (const bucket of plan.buckets || []) {
        if (bucket?.fund?.tsCode) allSelectedCodes.add(bucket.fund.tsCode);
        const assetClass = String(bucket?.assetClass || '');
        const fund = bucket?.fund;
        if (!fund) continue;

        if (/固收|债|现金|底仓/.test(assetClass) && !isBondLike(fund)) {
          errors.push(`bucket mismatch: ${plan.name}/${assetClass} -> ${fund.tsCode}`);
        }
        if (/黄金|商品|避险/.test(assetClass) && !isGoldLike(fund)) {
          errors.push(`bucket mismatch: ${plan.name}/${assetClass} -> ${fund.tsCode}`);
        }
        if (/海外/.test(assetClass) && !isOverseasLike(fund)) {
          errors.push(`bucket mismatch: ${plan.name}/${assetClass} -> ${fund.tsCode}`);
        }
        if (/低波/.test(assetClass) && !(isLowVolLike(fund) || isBondLike(fund))) {
          errors.push(`bucket mismatch: ${plan.name}/${assetClass} -> ${fund.tsCode}`);
        }
        if (/权益核心|主题/.test(assetClass) && !(isEquityLike(fund) && !isBondLike(fund))) {
          errors.push(`bucket mismatch: ${plan.name}/${assetClass} -> ${fund.tsCode}`);
        }
      }
    }

    if (allSelectedCodes.size < Math.min(6, bucketCount)) {
      errors.push(`allocation diversity too low: uniqueFunds=${allSelectedCodes.size}, buckets=${bucketCount}`);
    }
  }

  const planCount = Array.isArray(assetAllocation?.plans) ? assetAllocation.plans.length : 0;
  const bucketCount = Array.isArray(assetAllocation?.plans)
    ? assetAllocation.plans.reduce(
        (acc, p) => acc + (Array.isArray(p.buckets) ? p.buckets.length : 0),
        0,
      )
    : 0;

  console.table([
    {
      ok: Boolean(data?.ok),
      summaryRows: Array.isArray(data?.summary) ? data.summary.length : 0,
      fundRecRows: fundRecommendations ? fundRecommendations.length : 0,
      planCount,
      bucketCount,
      llmGenerated: Boolean(assetAllocation?.llmGenerated),
      outlook: String(assetAllocation?.outlook || '-'),
    },
  ]);

  if (errors.length) {
    console.error('\nEvent-impact fund/allocation checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nEvent-impact fund/allocation checks passed.');
})();
