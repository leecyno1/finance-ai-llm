#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const must = (cond, msg) => {
  if (!cond) fail(msg);
};

const parseJsonLines = async (res) => {
  const text = await res.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const run = async () => {
  const bogusModel = {
    providerId: 'bogus-provider',
    key: 'bogus-model',
  };

  const searchBody = {
    optimizationMode: 'balanced',
    focusMode: 'eventImpactMatrix',
    chatModel: bogusModel,
    embeddingModel: bogusModel,
    query: '请总结今日最重要的市场事件并给出事件驱动线索',
    history: [],
    stream: false,
    systemInstructions: '请用中文回答。',
  };

  const searchRes = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody),
  });
  must(searchRes.ok, `/api/search non-stream HTTP ${searchRes.status}`);
  const searchJson = await searchRes.json();

  must(
    typeof searchJson?.message === 'string' && searchJson.message.trim().length > 0,
    '/api/search missing message',
  );
  must(Array.isArray(searchJson?.sources), '/api/search missing sources');
  must(
    Array.isArray(searchJson?.searchResults) && searchJson.searchResults.length > 0,
    '/api/search missing searchResults',
  );
  must(
    searchJson?.researchComplete === true,
    '/api/search missing researchComplete=true',
  );

  const streamRes = await fetch(`${baseUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...searchBody,
      stream: true,
    }),
  });
  must(streamRes.ok, `/api/search stream HTTP ${streamRes.status}`);
  const streamEvents = await parseJsonLines(streamRes);
  const streamTypes = streamEvents.map((x) => x.type);

  must(streamTypes.includes('init'), '/api/search stream missing init');
  must(
    streamTypes.includes('searchResults'),
    '/api/search stream missing searchResults',
  );
  must(
    streamTypes.includes('researchComplete'),
    '/api/search stream missing researchComplete',
  );
  must(streamTypes.includes('response'), '/api/search stream missing response');
  must(streamTypes.includes('done'), '/api/search stream missing done');

  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        messageId: `p16-msg-${Date.now()}`,
        chatId: `p16-chat-${Date.now()}`,
        content: '请输出今日事件驱动的关键结论',
      },
      optimizationMode: 'balanced',
      focusMode: 'eventImpactMatrix',
      history: [],
      files: [],
      chatModel: bogusModel,
      embeddingModel: bogusModel,
      systemInstructions: '请用中文回答。',
    }),
  });
  must(chatRes.ok, `/api/chat deterministic HTTP ${chatRes.status}`);
  const chatEvents = await parseJsonLines(chatRes);
  const chatTypes = chatEvents.map((x) => x.type);

  must(chatTypes.includes('status'), '/api/chat missing status event');
  must(chatTypes.includes('message'), '/api/chat missing message event');
  must(chatTypes.includes('messageEnd'), '/api/chat missing messageEnd event');

  console.table([
    {
      searchResults: searchJson.searchResults.length,
      nonStreamResearchComplete: searchJson.researchComplete,
      streamEventTypes: streamTypes.join(','),
      chatEventTypes: chatTypes.join(','),
    },
  ]);
  console.log('\nP1.6 api search agent contract checks passed.');
};

run().catch((err) =>
  fail(`P1.6 api search agent contract failed: ${err?.message || String(err)}`),
);
