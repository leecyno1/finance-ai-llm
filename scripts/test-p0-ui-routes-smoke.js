#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const pages = [
  { path: '/event-impact', keyword: '事件驱动' },
  { path: '/asset-allocation', keyword: '资产配置' },
  { path: '/portfolio-check', keyword: '基金诊断' },
];

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const run = async () => {
  const rows = [];

  for (const p of pages) {
    const res = await fetch(`${baseUrl}${p.path}`, { cache: 'no-store' });
    if (!res.ok) fail(`${p.path} HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes(p.keyword)) {
      fail(`${p.path} missing keyword: ${p.keyword}`);
    }
    rows.push({
      page: p.path,
      status: res.status,
      bytes: html.length,
      keyword: p.keyword,
    });
  }

  console.table(rows);
  console.log('\nP0 UI route smoke checks passed.');
};

run().catch((err) => fail(`P0 ui route smoke failed: ${err?.message || String(err)}`));

