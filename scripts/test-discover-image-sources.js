#!/usr/bin/env node

const baseUrl = process.env.DISCOVER_BASE_URL || 'http://localhost:3001';
const topics = ['finance', 'art', 'sports'];
const langs = ['zh', 'en'];

const MAX_ITEMS = 80;
const MAX_OG_FALLBACK_RATIO = 0.4;

async function check(topic, lang) {
  const url = `${baseUrl}/api/discover?topic=${topic}&lang=${lang}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`${topic}/${lang}: HTTP ${res.status}`);
  }

  const payload = await res.json();
  const blogs = Array.isArray(payload.blogs) ? payload.blogs : [];
  const total = blogs.length;
  const ogFallback = blogs.filter((b) =>
    String(b?.thumbnail || '').startsWith('/api/og-image?'),
  ).length;
  const directHttpThumb = blogs.filter((b) =>
    /^https?:\/\//i.test(String(b?.thumbnail || '')),
  ).length;

  const ratio = total > 0 ? ogFallback / total : 1;

  const row = {
    topic,
    lang,
    total,
    ogFallback,
    directHttpThumb,
    ogRatio: Number(ratio.toFixed(3)),
  };

  const errors = [];
  if (total === 0) errors.push('no content');
  if (total > MAX_ITEMS) errors.push(`too many items: ${total} > ${MAX_ITEMS}`);
  if (ratio > MAX_OG_FALLBACK_RATIO)
    errors.push(`og fallback ratio too high: ${ratio.toFixed(3)} > ${MAX_OG_FALLBACK_RATIO}`);

  return { row, errors };
}

(async () => {
  const failed = [];
  const rows = [];

  for (const topic of topics) {
    for (const lang of langs) {
      const { row, errors } = await check(topic, lang);
      rows.push(row);
      if (errors.length) {
        failed.push({ row, errors });
      }
    }
  }

  console.table(rows);

  if (failed.length) {
    console.error('\nDiscover image-source checks failed:');
    for (const f of failed) {
      console.error(
        `- ${f.row.topic}/${f.row.lang}: ${f.errors.join('; ')}`,
      );
    }
    process.exit(1);
  }

  console.log('\nDiscover image-source checks passed.');
})();
