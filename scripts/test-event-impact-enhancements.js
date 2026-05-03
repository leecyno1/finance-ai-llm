#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const normalize = (v) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const eventKey = (row) => {
  const url = normalize(row?.sourceUrl || '').replace(/[?#].*$/, '');
  if (url) return `url:${url}`;
  const title = normalize(row?.event || '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 64);
  return `title:${title}`;
};

(async () => {
  const res = await fetch(`${baseUrl}/api/finance/event-impact?limit=120`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const matrix = Array.isArray(data.matrix) ? data.matrix : [];
  const summary = Array.isArray(data.summary) ? data.summary : null;

  const seen = new Set();
  let dup = 0;
  for (const row of matrix) {
    const key = eventKey(row);
    if (seen.has(key)) dup += 1;
    else seen.add(key);
  }
  const duplicateRatio = matrix.length ? dup / matrix.length : 1;

  const errors = [];
  if (!summary || !summary.length) {
    errors.push('missing impact summary table');
  }
  if (duplicateRatio > 0.25) {
    errors.push(`duplicate ratio too high: ${duplicateRatio.toFixed(3)} > 0.25`);
  }

  if (summary && summary.length) {
    for (const row of summary.slice(0, 10)) {
      if (!['positive', 'mixed', 'negative'].includes(String(row.direction))) {
        errors.push('summary direction invalid');
        break;
      }
      if (!(Number(row.confidence) >= 0.4 && Number(row.confidence) <= 1)) {
        errors.push('summary confidence invalid');
        break;
      }
    }
  }

  console.table([
    {
      matrixRows: matrix.length,
      duplicateRows: dup,
      duplicateRatio: Number(duplicateRatio.toFixed(3)),
      summaryRows: summary ? summary.length : 0,
    },
  ]);

  if (errors.length) {
    console.error('\nEvent-impact enhancement checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nEvent-impact enhancement checks passed.');
})();
