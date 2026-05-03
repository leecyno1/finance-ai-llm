#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
const topics = ['art', 'sports'];

const hasChinese = (s) => /[\u4e00-\u9fff]/.test(String(s || ''));

async function fetchBlogs(topic, lang) {
  const res = await fetch(`${baseUrl}/api/discover?topic=${topic}&lang=${lang}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${topic}/${lang} HTTP ${res.status}`);
  const data = await res.json();
  const blogs = Array.isArray(data.blogs) ? data.blogs : [];
  return blogs;
}

(async () => {
  const rows = [];
  const errors = [];

  for (const topic of topics) {
    for (const lang of ['zh', 'en']) {
      const blogs = await fetchBlogs(topic, lang);
      const sample = blogs.slice(0, 20);
      const zhCount = sample.filter((b) => hasChinese(`${b.title || ''} ${b.content || ''}`)).length;
      const ratio = sample.length ? zhCount / sample.length : 0;

      rows.push({
        topic,
        lang,
        total: blogs.length,
        sampleSize: sample.length,
        chineseRatio: Number(ratio.toFixed(2)),
      });

      if (lang === 'zh' && sample.length > 0 && ratio < 0.55) {
        errors.push(`${topic}/${lang} chineseRatio too low: ${ratio.toFixed(2)} < 0.55`);
      }
      if (lang === 'en' && sample.length > 0 && ratio > 0.75) {
        errors.push(`${topic}/${lang} chineseRatio too high: ${ratio.toFixed(2)} > 0.75`);
      }
    }
  }

  console.table(rows);

  if (errors.length) {
    console.error('\nDiscover localization checks failed:');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log('\nDiscover localization checks passed.');
})();
