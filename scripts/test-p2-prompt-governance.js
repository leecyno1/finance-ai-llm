#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

const ALLOWED_SOURCES = new Set(['env', 'config', 'default']);

const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

(async () => {
  const eventRes = await fetch(`${baseUrl}/api/finance/event-impact?limit=10`, {
    cache: 'no-store',
  });
  must(eventRes.ok, `event-impact HTTP ${eventRes.status}`);
  const eventData = await eventRes.json();
  const eventPromptMeta = eventData?.promptMeta || {};

  must(eventData?.ok === true, 'event-impact ok=false');
  must(ALLOWED_SOURCES.has(String(eventPromptMeta.marketViewTemplateSource || '')), 'invalid marketViewTemplateSource');
  must(ALLOWED_SOURCES.has(String(eventPromptMeta.fundPanelTemplateSource || '')), 'invalid fundPanelTemplateSource');
  must(typeof eventPromptMeta.marketViewTemplateCustomized === 'boolean', 'marketViewTemplateCustomized must be boolean');
  must(typeof eventPromptMeta.fundPanelTemplateCustomized === 'boolean', 'fundPanelTemplateCustomized must be boolean');

  const portfolioRes = await fetch(`${baseUrl}/api/finance/portfolio-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: ['600519 40', '000001 35', '510300 25'].join('\n'),
    }),
  });
  must(portfolioRes.ok, `portfolio-check HTTP ${portfolioRes.status}`);
  const portfolioData = await portfolioRes.json();
  const agentMeta = portfolioData?.agentMeta || {};

  must(portfolioData?.ok === true, 'portfolio-check ok=false');
  must(ALLOWED_SOURCES.has(String(agentMeta.promptTemplateSource || '')), 'invalid promptTemplateSource');
  must(ALLOWED_SOURCES.has(String(agentMeta.systemPromptSource || '')), 'invalid systemPromptSource');

  console.table([
    {
      eventPromptSource: eventPromptMeta.marketViewTemplateSource,
      fundPanelPromptSource: eventPromptMeta.fundPanelTemplateSource,
      eventPromptCustomized: eventPromptMeta.marketViewTemplateCustomized,
      fundPanelPromptCustomized: eventPromptMeta.fundPanelTemplateCustomized,
      portfolioPromptSource: agentMeta.promptTemplateSource,
      portfolioSystemSource: agentMeta.systemPromptSource,
    },
  ]);

  console.log('\nP2 prompt governance checks passed.');
})();
