#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const discoverTopics = ['tech', 'finance', 'art', 'sports', 'entertainment'];
const discoverLangs = ['zh', 'en'];

const endpoints = [
  '/api/news/finance',
  '/api/economy/news',
  '/api/economy/summary',
  '/api/finance/event-impact?limit=10',
];

for (const topic of discoverTopics) {
  for (const lang of discoverLangs) {
    endpoints.push(`/api/discover?topic=${encodeURIComponent(topic)}&lang=${lang}`);
  }
}

const fetchOne = async (path) => {
  const url = `${baseUrl}${path}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      console.error(`✗ ${path} -> HTTP ${res.status} (${ms}ms)`);
      return { path, ok: false, ms, status: res.status };
    }

    const data = await res.json();
    const cached = data?.cached;
    const slot = data?.slot || data?.fundUniverseMeta?.slot || '';
    console.log(`✓ ${path} -> ${cached === true ? 'cache' : 'fresh'} ${slot ? `[slot ${slot}]` : ''} (${ms}ms)`);
    return { path, ok: true, ms, cached: cached === true, slot: String(slot || '') };
  } catch (err) {
    const ms = Date.now() - startedAt;
    console.error(`✗ ${path} -> ${err?.message || String(err)} (${ms}ms)`);
    return { path, ok: false, ms, error: err?.message || String(err) };
  }
};

(async () => {
  console.log(`Warming ${endpoints.length} endpoints from ${baseUrl}...`);
  const results = [];
  for (const ep of endpoints) {
    results.push(await fetchOne(ep));
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  console.log(`\nWarm-up done: ${okCount}/${results.length} succeeded, ${failCount} failed.`);

  if (failCount > 0) process.exit(1);
})();
