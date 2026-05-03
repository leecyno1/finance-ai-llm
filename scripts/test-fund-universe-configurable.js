#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const res = await fetch(`${baseUrl}/api/finance/event-impact?limit=20`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const meta = data?.fundUniverseMeta || {};
  const errors = [];

  if (!Array.isArray(meta.companyFilterKeywords)) {
    errors.push('fundUniverseMeta.companyFilterKeywords should be an array');
  }

  if (typeof meta.localSourcePath !== 'string') {
    errors.push('fundUniverseMeta.localSourcePath should be a string');
  }

  if (typeof meta.localSourceConfigured !== 'boolean') {
    errors.push('fundUniverseMeta.localSourceConfigured should be a boolean');
  }

  console.table([
    {
      ok: Boolean(data?.ok),
      localCount: Number(meta?.localCount || 0),
      dynamicCount: Number(meta?.dynamicCount || 0),
      totalCount: Number(meta?.totalCount || 0),
      companyFilterKeywords: Array.isArray(meta.companyFilterKeywords)
        ? meta.companyFilterKeywords.join('|')
        : '-',
      localSourcePath: String(meta.localSourcePath || '-'),
      localSourceConfigured: Boolean(meta.localSourceConfigured),
    },
  ]);

  if (errors.length) {
    console.error('\nFund universe configurability checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nFund universe configurability checks passed.');
})();
