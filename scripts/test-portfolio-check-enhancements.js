#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const input = ['600519 40', '000001 35', '510300 25'].join('\n');

  const res = await fetch(`${baseUrl}/api/finance/portfolio-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const markdown = String(data?.markdown || '');

  const errors = [];
  if (!markdown.includes('## TuShare') && !markdown.includes('## Tushare')) {
    errors.push('missing TuShare detail section');
  }
  if (!markdown.includes('## 首页 Agent 综合分析')) {
    errors.push('missing homepage agent analysis section');
  }
  if (!markdown.includes('平安银行') || !markdown.includes('贵州茅台')) {
    errors.push('missing enriched CN holding names in diagnosis');
  }
  if (/\|\s+000001\s+\|\s+000001\s+\|/.test(markdown)) {
    errors.push('holding diagnosis still falls back to raw 000001 symbol name');
  }
  if (/\|\s+600519\s+\|\s+600519\s+\|/.test(markdown)) {
    errors.push('holding diagnosis still falls back to raw 600519 symbol name');
  }
  if (markdown.includes('| Global | 100.00% |')) {
    errors.push('region exposure still incorrectly remains Global 100%');
  }
  if (markdown.includes('| 未知行业 | 100.00% |')) {
    errors.push('sector exposure still incorrectly remains 未知行业 100%');
  }
  if (!markdown.includes('| 白酒 | 40.00% |')) {
    errors.push('missing fine-grained 白酒 sector exposure');
  }
  if (!markdown.includes('| 银行 | 35.00% |')) {
    errors.push('missing fine-grained 银行 sector exposure');
  }
  if (!markdown.includes('| 沪深300 | 25.00% |')) {
    errors.push('missing fine-grained 沪深300 sector exposure');
  }
  if (!markdown.includes('沪深300/红利低波或中短债')) {
    errors.push('missing sector-specific rebalance action hint for 白酒 concentration');
  }
  if (markdown.includes('区域集中在 CN')) {
    errors.push('domestic-only portfolio should not trigger CN concentration rebalance warning');
  }
  if (!markdown.includes('## 备选基金动作')) {
    errors.push('missing fund action recommendation section');
  }
  if (!Array.isArray(data?.result?.fundActionRecommendations) || data.result.fundActionRecommendations.length === 0) {
    errors.push('missing structured fund action recommendations');
  }
  if (!data?.result?.fundActionRecommendations?.some((row) => Array.isArray(row?.funds) && row.funds.length > 0)) {
    errors.push('fund action recommendations have no candidate funds');
  }
  const fundActionSectionCount = markdown.split('## 备选基金动作').length - 1;
  if (fundActionSectionCount !== 1) {
    errors.push(`fund action section should render once, got ${fundActionSectionCount}`);
  }

  const fundActions = Array.isArray(data?.result?.fundActionRecommendations)
    ? data.result.fundActionRecommendations
    : [];
  const concentrationAction = fundActions.find((row) => String(row?.target || '').includes('白酒集中替代'));
  if (!concentrationAction) {
    errors.push('missing 白酒 concentration replacement action');
  } else {
    if (concentrationAction.action !== '风险替代') {
      errors.push('白酒 concentration replacement should be marked as 风险替代');
    }
    const fundIdentityText = (concentrationAction.funds || [])
      .map((fund) => [fund?.name, fund?.category, fund?.style].join(' '))
      .join(' ');
    const fundFullText = JSON.stringify(concentrationAction.funds || []);
    if (/白酒|消费主题|食品饮料/.test(fundIdentityText)) {
      errors.push('白酒 concentration replacement should not recommend literal 白酒/消费 theme funds');
    }
    if (/信号偏利多/.test(fundFullText)) {
      errors.push('risk replacement prompt should not use 利多 add-position wording');
    }
    if (!/降低单一行业暴露|集中度降至目标区间/.test(fundFullText)) {
      errors.push('risk replacement prompt should explain concentration reduction');
    }
  }

  console.table([
    {
      ok: Boolean(data?.ok),
      hasResult: Boolean(data?.result),
      markdownLength: markdown.length,
      hasTushareSection: markdown.includes('TuShare') || markdown.includes('Tushare'),
      hasAgentSection: markdown.includes('## 首页 Agent 综合分析'),
    },
  ]);

  if (errors.length) {
    console.error('\nPortfolio-check enhancement checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nPortfolio-check enhancement checks passed.');
})();
