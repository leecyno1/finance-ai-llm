#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const fetchJson = async (url) => {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return json;
};

(async () => {
  const discoverUrl = `${baseUrl}/api/discover?topic=finance&lang=zh`;
  const economyNewsUrl = `${baseUrl}/api/economy/news`;
  const eventImpactUrl = `${baseUrl}/api/finance/event-impact?limit=10`;

  const d1 = await fetchJson(discoverUrl);
  const d2 = await fetchJson(discoverUrl);

  const n1 = await fetchJson(economyNewsUrl);
  const n2 = await fetchJson(economyNewsUrl);

  const e1 = await fetchJson(eventImpactUrl);
  const e2 = await fetchJson(eventImpactUrl);

  const errors = [];

  if (!Array.isArray(d2.blogs) || d2.blogs.length === 0) {
    errors.push('discover blogs missing');
  }
  if (typeof d2.slot !== 'string') {
    errors.push('discover slot missing');
  }
  if (typeof n2.slot !== 'string') {
    errors.push('economy/news slot missing');
  }
  if (typeof e2.slot !== 'string') {
    errors.push('event-impact slot missing');
  }

  console.table([
    {
      discoverSlot: String(d2.slot || '-'),
      discoverCached: Boolean(d2.cached),
      economyNewsSlot: String(n2.slot || '-'),
      economyNewsCached: Boolean(n2.cached),
      eventImpactSlot: String(e2.slot || '-'),
      eventImpactCached: Boolean(e2.cached),
      eventRows: Array.isArray(e2.matrix) ? e2.matrix.length : 0,
    },
  ]);

  if (errors.length) {
    console.error('\nSix-hour cache alignment checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nSix-hour cache alignment checks passed.');
})();
