#!/usr/bin/env node

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const chatId = `report-e2e-${Date.now()}`;
const messageId = `msg-${Date.now()}`;
const query = process.env.E2E_QUERY || '以券商研报形式，写一篇中际旭创最新的分析报告，要求包含财务分析、估值框架、风险提示和数据来源说明';

const readStream = async (res) => {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
};

const parseEvents = (raw) => raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => (line.startsWith('data:') ? line.slice(5).trim() : line))
  .filter(Boolean)
  .map((payload) => {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const main = async () => {
  const routingRes = await fetch(`${baseUrl}/api/models/routing`);
  if (!routingRes.ok) {
    throw new Error(`model routing failed: HTTP ${routingRes.status}`);
  }
  const routing = await routingRes.json();
  const chatModel = routing.deepResearch || routing.daily;
  const embeddingModel = routing.embedding;

  if (!chatModel?.providerId || !chatModel?.key) {
    throw new Error('no chat model configured for E2E request');
  }
  if (!embeddingModel?.providerId || !embeddingModel?.key) {
    throw new Error('no embedding model configured for E2E request');
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { messageId, chatId, content: query },
      optimizationMode: 'quality',
      focusMode: 'webSearch',
      history: [],
      files: [],
      chatModel: { providerId: chatModel.providerId, key: chatModel.key },
      embeddingModel: { providerId: embeddingModel.providerId, key: embeddingModel.key },
      systemInstructions: '',
    }),
  });

  const raw = await readStream(res);
  if (!res.ok) {
    throw new Error(`chat request failed: HTTP ${res.status}\n${raw.slice(0, 1000)}`);
  }

  const events = parseEvents(raw);
  const answer = events
    .filter((event) => event.type === 'message')
    .map((event) => String(event.data || ''))
    .join('');
  const meta = events.find((event) => event.type === 'meta' && event.data?.minResearchReportChars);

  const checks = {
    httpOk: res.status === 200,
    charsAtLeast5000: [...answer].length >= 5000,
    hasRiskWarning: /风险提示/.test(answer),
    hasDataSourceNote: /数据来源|researchDataPack|TuShare|akshare|未取得可靠数据/.test(answer),
    hasTable: /\|.+\|/.test(answer),
    hasMessageEnd: events.some((event) => event.type === 'messageEnd'),
    hasStatusComplete: events.some((event) => event.type === 'statusComplete'),
    hasResearchMeta: Boolean(meta),
  };

  console.table({
    chatId,
    chars: [...answer].length,
    events: events.length,
    ...checks,
  });

  const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  if (failed.length) {
    throw new Error(`P2.0 research report E2E failed: ${failed.join(', ')}`);
  }

  console.log(`\nP2.0 research report E2E passed: ${baseUrl}/c/${chatId}`);
};

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
