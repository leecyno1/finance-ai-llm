#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const res = await fetch(`${baseUrl}/api/economy/news`, { cache: 'no-store' });
  const data = await res.json();

  const checks = {
    httpOk: res.ok,
    hasOkField: typeof data.ok === 'boolean',
    hasCachedField: typeof data.cached === 'boolean',
    hasSlotField: typeof data.slot === 'string' && data.slot.length > 0,
    hasCountField: typeof data.count === 'number',
    hasItemsArray: Array.isArray(data.items),
    hasSourceStatsArray: Array.isArray(data.sourceStats),
    hasSourceHealthArray: Array.isArray(data.sourceHealth),
  };

  console.table(checks);

  const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (failed.length > 0) {
    console.error(`\nP0 economy news schema check failed: ${failed.join(', ')}`);
    process.exit(1);
  }

  console.log('\nP0 economy news schema check passed.');
})();
