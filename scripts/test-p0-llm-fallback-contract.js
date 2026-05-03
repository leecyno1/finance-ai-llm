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
  const eventRes = await fetch(`${baseUrl}/api/finance/event-impact?limit=10`, {
    cache: 'no-store',
  });
  must(eventRes.ok, `event-impact HTTP ${eventRes.status}`);
  const eventData = await eventRes.json();

  must(eventData?.ok === true, 'event-impact response missing ok=true');
  must(eventData?.assetAllocation, 'event-impact missing assetAllocation');
  must(
    Array.isArray(eventData?.assetAllocation?.plans) &&
      eventData.assetAllocation.plans.length >= 1,
    'event-impact assetAllocation.plans invalid',
  );
  must(
    typeof eventData?.assetAllocation?.marketView === 'string' &&
      eventData.assetAllocation.marketView.trim().length > 0,
    'event-impact assetAllocation.marketView missing',
  );

  // P0 contract: allocation mode must be explicit (llm / rule-fallback)
  must(eventData?.assetAllocationMeta, 'event-impact missing assetAllocationMeta');
  must(
    ['llm', 'rule-fallback'].includes(String(eventData.assetAllocationMeta?.mode)),
    `event-impact invalid assetAllocationMeta.mode: ${String(
      eventData.assetAllocationMeta?.mode,
    )}`,
  );

  const portfolioRes = await fetch(`${baseUrl}/api/finance/portfolio-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      holdings: [
        { symbol: '510300', weight: 30 },
        { symbol: '159919', weight: 30 },
        { symbol: '511010', weight: 40 },
      ],
    }),
  });
  must(portfolioRes.ok, `portfolio-check HTTP ${portfolioRes.status}`);
  const portfolioData = await portfolioRes.json();

  must(portfolioData?.ok === true, 'portfolio-check response missing ok=true');
  must(Array.isArray(portfolioData?.sections), 'portfolio-check sections missing');
  must(
    portfolioData.sections.some((x) => x?.id === 'agent'),
    'portfolio-check missing agent section',
  );

  // P0 contract: agent mode must be explicit (llm / fallback)
  must(portfolioData?.agentMeta, 'portfolio-check missing agentMeta');
  must(
    ['llm', 'fallback'].includes(String(portfolioData.agentMeta?.mode)),
    `portfolio-check invalid agentMeta.mode: ${String(portfolioData.agentMeta?.mode)}`,
  );

  console.table([
    {
      eventImpactOk: true,
      allocationMode: String(eventData.assetAllocationMeta.mode),
      portfolioOk: true,
      agentMode: String(portfolioData.agentMeta.mode),
    },
  ]);
  console.log('\nP0 llm-fallback contract checks passed.');
};

run().catch((err) => fail(`P0 llm-fallback contract failed: ${err?.message || String(err)}`));

