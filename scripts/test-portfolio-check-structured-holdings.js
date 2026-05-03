#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const holdings = [
    { code: '600519', weight: 40 },
    { name: '平安银行', ratio: '35' },
    { code: '510300', weight: 25 },
  ];

  const res = await fetch(`${baseUrl}/api/finance/portfolio-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const markdown = String(data?.markdown || '');
  const parsed = Array.isArray(data?.result?.parsedHoldings)
    ? data.result.parsedHoldings
    : [];
  const symbols = parsed.map((row) => String(row?.symbol || '').toUpperCase());
  const names = parsed.map((row) => String(row?.profile?.name || ''));
  const sectors = data?.result?.exposure?.bySector || {};
  const errors = [];

  if (!data?.ok || !data?.result) {
    errors.push('missing successful portfolio-check result');
  }
  if (parsed.length !== 3) {
    errors.push(`expected 3 parsed holdings, got ${parsed.length}`);
  }
  if (!symbols.some((x) => x.includes('600519'))) {
    errors.push('structured code input did not keep/resolve 600519');
  }
  if (!names.includes('贵州茅台')) {
    errors.push('structured code input did not enrich 贵州茅台');
  }
  if (!names.includes('平安银行')) {
    errors.push('structured name input did not resolve/enrich 平安银行');
  }
  if (Number(sectors['白酒'] || 0) !== 40) {
    errors.push('structured input missing 白酒 40% exposure');
  }
  if (Number(sectors['银行'] || 0) !== 35) {
    errors.push('structured input missing 银行 35% exposure');
  }
  if (!markdown.includes('## 备选基金动作')) {
    errors.push('structured input missing fund action markdown');
  }

  console.table([
    {
      ok: Boolean(data?.ok),
      parsedCount: parsed.length,
      symbols: symbols.join(', '),
      names: names.join(', '),
      markdownLength: markdown.length,
    },
  ]);

  if (errors.length) {
    console.error('\nPortfolio-check structured holdings checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nPortfolio-check structured holdings checks passed.');
})();
