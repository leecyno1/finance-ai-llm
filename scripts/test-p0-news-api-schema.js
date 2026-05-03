#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const res = await fetch(`${baseUrl}/api/news/finance`, { cache: 'no-store' });
  const data = await res.json();

  const checks = {
    httpOk: res.ok,
    hasOkField: typeof data.ok === 'boolean',
    hasCachedField: typeof data.cached === 'boolean',
    hasSlotField: typeof data.slot === 'string' && data.slot.length > 0,
    hasCountField: typeof data.count === 'number',
    hasItemsArray: Array.isArray(data.items),
    hasSourceStats: data.sourceStats && typeof data.sourceStats === 'object',
  };

  console.table(checks);

  const failed = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (failed.length) {
    console.error(`\nP0 schema check failed: ${failed.join(', ')}`);
    process.exit(1);
  }

  console.log('\nP0 schema check passed.');
})();
