#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const must = (cond, msg) => {
  if (!cond) fail(msg);
};

const run = async () => {
  // Generate some misses/hits first.
  await Promise.all([
    fetch(`${baseUrl}/api/news/finance`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/economy/news`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/discover?topic=finance&lang=zh`, { cache: 'no-store' }),
    fetch(`${baseUrl}/api/finance/event-impact?limit=30`, { cache: 'no-store' }),
  ]);

  const res = await fetch(`${baseUrl}/api/cache/observability`, {
    cache: 'no-store',
  });
  must(res.ok, `cache/observability HTTP ${res.status}`);
  const data = await res.json();

  must(data?.ok === true, 'cache/observability missing ok=true');
  must(Array.isArray(data?.slowRecomputeTop), 'slowRecomputeTop missing');
  must(data?.trendSeries && typeof data.trendSeries === 'object', 'trendSeries missing');
  must(data?.thresholds && typeof data.thresholds === 'object', 'thresholds missing');
  must(
    Number(data?.thresholds?.hitRateWarn) > 0 &&
      Number(data?.thresholds?.hitRateWarn) < 100,
    'thresholds.hitRateWarn invalid',
  );
  must(
    Number(data?.thresholds?.recomputeAvgWarnMs) > 0,
    'thresholds.recomputeAvgWarnMs invalid',
  );
  must(
    Number(data?.thresholds?.recomputeMaxWarnMs) > 0,
    'thresholds.recomputeMaxWarnMs invalid',
  );

  const rows = data.slowRecomputeTop;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    must(typeof row.module === 'string' && row.module.length > 0, 'slowTop row missing module');
    must(typeof row.slot === 'string' && row.slot.length > 0, 'slowTop row missing slot');
    must(Number.isFinite(Number(row.recomputeAvgMs)), 'slowTop row invalid recomputeAvgMs');
    must(Number.isFinite(Number(row.recomputeMaxMs)), 'slowTop row invalid recomputeMaxMs');

    if (i > 0) {
      const prev = Number(rows[i - 1]?.recomputeAvgMs || 0);
      const curr = Number(row.recomputeAvgMs || 0);
      must(prev >= curr, 'slowRecomputeTop not sorted by recomputeAvgMs desc');
    }
  }

  const filteredRes = await fetch(
    `${baseUrl}/api/cache/observability?module=event_impact&windowHours=24&topN=5`,
    { cache: 'no-store' },
  );
  must(filteredRes.ok, `cache/observability(filtered) HTTP ${filteredRes.status}`);
  const filtered = await filteredRes.json();
  must(Array.isArray(filtered?.slowRecomputeTop), 'filtered slowRecomputeTop missing');
  must(
    String(filtered?.filter?.module || '') === 'event_impact',
    'filtered response missing module filter',
  );
  must(
    Number(filtered?.filter?.windowHours || 0) === 24,
    'filtered response missing windowHours filter',
  );
  must(Number(filtered?.filter?.topN || 0) === 5, 'filtered response missing topN filter');
  must(
    filtered.slowRecomputeTop.every((x) => String(x?.module) === 'event_impact'),
    'filtered slowRecomputeTop contains non-event_impact module',
  );
  must(
    filtered.slowRecomputeTop.length <= 5,
    'filtered slowRecomputeTop does not respect topN',
  );
  const trendKeys = Object.keys(filtered?.trendSeries || {});
  must(
    trendKeys.length === 1 && trendKeys[0] === 'event_impact',
    'filtered trendSeries should contain only selected module',
  );
  const trendRows = Array.isArray(filtered?.trendSeries?.event_impact)
    ? filtered.trendSeries.event_impact
    : [];
  for (let i = 1; i < trendRows.length; i += 1) {
    const prev = Number(trendRows[i - 1]?.ts || 0);
    const curr = Number(trendRows[i]?.ts || 0);
    must(curr >= prev, 'filtered trendSeries is not sorted by ts asc');
  }

  console.table([
    {
      hasSlowTop: true,
      slowTopCount: rows.length,
      firstModule: rows[0]?.module || '-',
      firstAvgMs: Number(rows[0]?.recomputeAvgMs || 0).toFixed(1),
      filteredCount: filtered.slowRecomputeTop.length,
      trendPoints: trendRows.length,
      hitRateWarn: Number(data?.thresholds?.hitRateWarn || 0),
    },
  ]);

  console.log('\nP1 cache slow-top checks passed.');
};

run().catch((err) => fail(`P1 cache slow-top failed: ${err?.message || String(err)}`));
