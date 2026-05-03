#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';

(async () => {
  const [providersRes, routingRes] = await Promise.all([
    fetch(`${baseUrl}/api/providers`),
    fetch(`${baseUrl}/api/models/routing`),
  ]);

  if (!providersRes.ok) throw new Error(`/api/providers HTTP ${providersRes.status}`);
  if (!routingRes.ok) throw new Error(`/api/models/routing HTTP ${routingRes.status}`);

  const providersData = await providersRes.json();
  const routing = await routingRes.json();
  const providers = Array.isArray(providersData?.providers) ? providersData.providers : [];
  const errors = [];

  const chatModels = providers.flatMap((p) =>
    (p.chatModels || []).map((m) => ({ provider: p.name, key: m.key })),
  );
  const embeddingModels = providers.flatMap((p) =>
    (p.embeddingModels || []).map((m) => ({ provider: p.name, key: m.key })),
  );

  if (!chatModels.some((m) => m.key === 'MiniMax-M2.7')) {
    errors.push('providers should expose MiniMax-M2.7 as the daily chat model');
  }
  if (chatModels.some((m) => m.key === 'DeepSeek-V4-Flash')) {
    errors.push('providers should not expose DeepSeek-V4-Flash in normal model selector');
  }
  if (!embeddingModels.some((m) => m.key === 'BAAI/bge-m3')) {
    errors.push('providers should expose BAAI/bge-m3 embedding model');
  }
  if (routing?.daily?.key !== 'MiniMax-M2.7') {
    errors.push(`daily route should use MiniMax-M2.7, got ${routing?.daily?.key || '-'}`);
  }
  if (routing?.deepResearch?.key !== 'DeepSeek-V4-Flash') {
    errors.push(`deepResearch route should use DeepSeek-V4-Flash, got ${routing?.deepResearch?.key || '-'}`);
  }
  if (routing?.deepResearch?.provider?.baseURL !== 'https://ai.gitee.com/v1') {
    errors.push('deepResearch route should use https://ai.gitee.com/v1');
  }
  if (routing?.embedding?.key !== 'BAAI/bge-m3') {
    errors.push(`embedding route should use BAAI/bge-m3, got ${routing?.embedding?.key || '-'}`);
  }

  console.table([
    {
      providerCount: providers.length,
      chatModels: chatModels.map((m) => `${m.provider}:${m.key}`).join(', '),
      embeddingModels: embeddingModels.map((m) => `${m.provider}:${m.key}`).join(', '),
      daily: routing?.daily?.key || '-',
      deepResearch: routing?.deepResearch?.key || '-',
      embedding: routing?.embedding?.key || '-',
    },
  ]);

  if (errors.length) {
    console.error('\nModel routing contract checks failed:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log('\nModel routing contract checks passed.');
})();
