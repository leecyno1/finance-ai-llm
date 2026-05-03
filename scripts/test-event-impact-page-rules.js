#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const res = await fetch(`${baseUrl}/api/finance/event-impact?limit=120`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  const keyEvents = Array.isArray(data?.keyEvents) ? data.keyEvents : null;
  const panel = Array.isArray(data?.fundRecommendationPanel)
    ? data.fundRecommendationPanel
    : null;

  const errors = [];

  if (!keyEvents) {
    errors.push('missing keyEvents');
  } else {
    if (keyEvents.length === 0 || keyEvents.length > 5) {
      errors.push(`keyEvents length invalid: ${keyEvents.length}`);
    }
    if (Number(data?.total || 0) >= 5 && keyEvents.length !== 5) {
      errors.push(`keyEvents should be exactly 5 when total>=5, got ${keyEvents.length}`);
    }

    for (let i = 1; i < keyEvents.length; i += 1) {
      const prev = Number(keyEvents[i - 1]?.compositeScore || 0);
      const curr = Number(keyEvents[i]?.compositeScore || 0);
      if (curr > prev) {
        errors.push('keyEvents are not sorted by compositeScore desc');
        break;
      }
    }

    for (const item of keyEvents) {
      if (!Array.isArray(item.examples) || item.examples.length === 0) {
        errors.push('keyEvents item missing examples');
        break;
      }
      if (typeof item.compositeScore !== 'number') {
        errors.push('keyEvents item missing compositeScore');
        break;
      }
      const sentiment = item?.sentiment || {};
      const sentimentTotal =
        Number(sentiment.positive || 0) +
        Number(sentiment.negative || 0) +
        Number(sentiment.mixed || 0) +
        Number(sentiment.neutral || 0);
      if (sentimentTotal < 1) {
        errors.push('keyEvents item has empty sentiment counts');
        break;
      }
    }
  }

  if (!panel) {
    errors.push('missing fundRecommendationPanel');
  } else {
    if (panel.length > 10) {
      errors.push(`fundRecommendationPanel too many rows: ${panel.length}`);
    }
    for (const row of panel) {
      if (!['positive', 'negative'].includes(String(row.direction))) {
        errors.push('fundRecommendationPanel contains non positive/negative direction');
        break;
      }
      if (!Array.isArray(row.funds) || row.funds.length > 2) {
        errors.push('fundRecommendationPanel has >2 funds in a row');
        break;
      }
    }
  }

  console.table([
    {
      keyEvents: keyEvents ? keyEvents.length : 0,
      panelRows: panel ? panel.length : 0,
      panelHasMixed: panel
        ? panel.some((x) => String(x.direction) === 'mixed')
        : true,
      panelMaxFundCount: panel
        ? Math.max(0, ...panel.map((x) => (Array.isArray(x.funds) ? x.funds.length : 0)))
        : 0,
    },
  ]);

  if (errors.length) {
    console.error('\nEvent-impact page rule checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nEvent-impact page rule checks passed.');
})();
