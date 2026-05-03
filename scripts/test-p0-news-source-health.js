#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const res = await fetch(`${baseUrl}/api/economy/news/health`, {
    cache: 'no-store',
  });
  const data = await res.json();

  const checks = {
    httpOk: res.ok,
    hasOkField: typeof data.ok === 'boolean',
    hasHealthArray: Array.isArray(data.health),
    hasTotals:
      typeof data.total === 'number' &&
      typeof data.available === 'number' &&
      typeof data.openCircuits === 'number',
    itemShape:
      Array.isArray(data.health) &&
      data.health.every(
        (item) =>
          item &&
          typeof item.name === 'string' &&
          typeof item.configuredEnabled === 'boolean' &&
          typeof item.circuitOpen === 'boolean' &&
          typeof item.consecutiveFailures === 'number',
      ),
  };

  console.table(checks);

  const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (failed.length > 0) {
    console.error(`\nP0 source health check failed: ${failed.join(', ')}`);
    process.exit(1);
  }

  console.log('\nP0 source health check passed.');
})();
