#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
const adminToken = String(process.env.ADMIN_ACCESS_TOKEN || '').trim();

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const must = (cond, msg) => {
  if (!cond) fail(msg);
};

const buildAuthHeaders = () => {
  if (!adminToken) return {};
  return { 'x-admin-token': adminToken };
};

const run = async () => {
  // Generate some traffic first so observability has data.
  await Promise.all([
    fetch(`${baseUrl}/api/news/finance`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/economy/news`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/discover?topic=finance&lang=zh`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/finance/event-impact?limit=10`, { cache: 'no-store' }),
  ]);

  const obsRes = await fetch(`${baseUrl}/api/cache/observability`, {
    cache: 'no-store',
  });
  must(obsRes.ok, `cache/observability HTTP ${obsRes.status}`);
  const obs = await obsRes.json();

  must(obs?.ok === true, 'cache/observability missing ok=true');
  must(obs?.modules && typeof obs.modules === 'object', 'cache/observability missing modules');
  const requiredModules = ['news_finance', 'economy_news', 'discover', 'event_impact'];
  requiredModules.forEach((k) => {
    must(obs.modules[k], `cache/observability missing module: ${k}`);
    must(Array.isArray(obs.modules[k].slots), `cache/observability module ${k} missing slots`);
  });

  const invalidRes = await fetch(`${baseUrl}/api/cache/invalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ scope: 'event_impact', rewarm: false }),
  });
  if (invalidRes.status === 401 && !adminToken) {
    fail('cache/invalidate requires admin token; set ADMIN_ACCESS_TOKEN for this test');
  }
  must(invalidRes.ok, `cache/invalidate HTTP ${invalidRes.status}`);
  const invalidData = await invalidRes.json();
  must(invalidData?.ok === true, 'cache/invalidate missing ok=true');
  must(String(invalidData?.scope || '') === 'event_impact', 'cache/invalidate scope mismatch');
  must(
    Array.isArray(invalidData?.deletedFiles) && invalidData.deletedFiles.length >= 1,
    'cache/invalidate deletedFiles missing',
  );

  const warmRes = await fetch(`${baseUrl}/api/cache/invalidate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ scope: 'event_impact', rewarm: true }),
  });
  if (warmRes.status === 401 && !adminToken) {
    fail('cache/invalidate(rewarm) requires admin token; set ADMIN_ACCESS_TOKEN for this test');
  }
  must(warmRes.ok, `cache/invalidate(rewarm) HTTP ${warmRes.status}`);
  const warmData = await warmRes.json();
  must(warmData?.ok === true, 'cache/invalidate(rewarm) missing ok=true');
  must(Array.isArray(warmData?.warmResults), 'cache/invalidate(rewarm) warmResults missing');

  console.table([
    {
      observability: true,
      invalidate: true,
      rewarm: true,
      warmCount: warmData.warmResults.length,
    },
  ]);
  console.log('\nP0 cache observability/invalidate checks passed.');
};

run().catch((err) =>
  fail(`P0 cache observability/invalidate failed: ${err?.message || String(err)}`),
);
