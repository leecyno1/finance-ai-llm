/* eslint-disable no-console */
const os = require('node:os');

const SHANGHAI_UTC_OFFSET_HOURS = 8;
const SHANGHAI_TZ = 'Asia/Shanghai';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getShanghaiParts = (d) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
};

const shanghaiLocalToUtcMs = (y, m, d, hh, mm, ss) =>
  Date.UTC(y, m - 1, d, hh - SHANGHAI_UTC_OFFSET_HOURS, mm, ss);

const nextShanghaiTime = ({ hour, minute, second = 0 }) => {
  const now = new Date();
  const p = getShanghaiParts(now);
  const nowMs = Date.now();

  let targetMs = shanghaiLocalToUtcMs(
    p.year,
    p.month,
    p.day,
    hour,
    minute,
    second,
  );
  if (targetMs <= nowMs + 1000) targetMs += 24 * 60 * 60 * 1000;
  return targetMs;
};

const fetchWithTimeout = async (url, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'user-agent': 'finance-ai-llm/cache-worker' },
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
};

const buildBaseUrlCandidates = () => {
  const port = process.env.PORT || 3000;
  const fromEnv = process.env.CACHE_BASE_URL || '';
  const hostName = os.hostname();
  const ips = Object.values(os.networkInterfaces() || {})
    .flat()
    .map((x) => x?.address)
    .filter((x) => typeof x === 'string' && x && x !== '127.0.0.1');

  const raw = [
    fromEnv,
    hostName ? `http://${hostName}:${port}` : '',
    ...ips.map((ip) => `http://${ip}:${port}`),
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ].filter(Boolean);
  const seen = new Set();
  return raw
    .map((x) => String(x).trim().replace(/\/+$/, ''))
    .filter((x) => {
      if (!x) return false;
      if (seen.has(x)) return false;
      seen.add(x);
      return true;
    });
};

const baseUrls = buildBaseUrlCandidates();
const enabled = (process.env.CACHE_WORKER_ENABLED || 'true').toLowerCase() !== 'false';

const state = {
  inFlightNews: false,
  inFlightEconomy: false,
  inFlightMacro: false,
  inFlightEventImpact: false,
};

const classifyRequestError = (err) => {
  if (!err) {
    return { type: 'unknown', message: 'unknown error' };
  }

  if (err.name === 'AbortError') {
    return { type: 'network_timeout', message: err.message || 'request timeout' };
  }

  const message = err?.message || String(err);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return { type: 'dns', message };
  }

  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket hang up/i.test(message)) {
    return { type: 'network', message };
  }

  if (/parse|json|unexpected token/i.test(message)) {
    return { type: 'parse', message };
  }

  return { type: 'unknown', message };
};

const requestEndpoint = async (path, timeoutMs, retries = 2) => {
  let lastErr = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    for (const baseUrl of baseUrls) {
      try {
        const res = await fetchWithTimeout(`${baseUrl}${path}`, timeoutMs);
        if (res.ok) return { res, baseUrl, attempt, failure: null };
        lastResponse = {
          res,
          baseUrl,
          attempt,
          failure: {
            type: 'non_2xx',
            status: res.status,
            message: `HTTP ${res.status}`,
          },
        };
      } catch (err) {
        lastErr = err;
      }
    }

    if (attempt < retries) {
      await sleep(Math.min(3000, 500 * 2 ** (attempt - 1)));
    }
  }

  if (lastResponse) return lastResponse;
  const fallbackErr = lastErr || new Error(`request failed for ${path}`);
  const wrapped = new Error(fallbackErr?.message || String(fallbackErr));
  wrapped.classification = classifyRequestError(fallbackErr);
  throw wrapped;
};

const waitForServer = async () => {
  const maxWaitMs = 90_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const { res } = await requestEndpoint('/api/config', 5000, 2);
      if (res.ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
};

const warmNews = async (reason) => {
  if (state.inFlightNews) return;
  state.inFlightNews = true;
  const startedAt = Date.now();
  try {
    const { res, baseUrl, attempt, failure } = await requestEndpoint(
      '/api/news/finance',
      25_000,
      3,
    );
    const text = await res.text();
    console.log(
      `[cache-worker] news ${reason} -> ${res.status} (${Date.now() - startedAt}ms) [${baseUrl}] attempt=${attempt}`,
    );
    if (!res.ok) {
      console.warn(
        `[cache-worker] news response failed [type=${failure?.type || 'non_2xx'} status=${res.status}] ${text.slice(0, 300)}`,
      );
    }
  } catch (err) {
    const cls = err?.classification || classifyRequestError(err);
    console.warn(
      `[cache-worker] news failed [type=${cls.type}]`,
      cls.message || err?.message || err,
    );
  } finally {
    state.inFlightNews = false;
  }
};

const warmEconomy = async (reason) => {
  if (state.inFlightEconomy) return;
  state.inFlightEconomy = true;
  const startedAt = Date.now();
  try {
    const { res, baseUrl, attempt, failure } = await requestEndpoint(
      '/api/economy/summary',
      60_000,
      3,
    );
    const text = await res.text();
    console.log(
      `[cache-worker] economy ${reason} -> ${res.status} (${Date.now() - startedAt}ms) [${baseUrl}] attempt=${attempt}`,
    );
    if (!res.ok) {
      console.warn(
        `[cache-worker] economy response failed [type=${failure?.type || 'non_2xx'} status=${res.status}] ${text.slice(0, 300)}`,
      );
    }
  } catch (err) {
    const cls = err?.classification || classifyRequestError(err);
    console.warn(
      `[cache-worker] economy failed [type=${cls.type}]`,
      cls.message || err?.message || err,
    );
  } finally {
    state.inFlightEconomy = false;
  }
};

const warmEventImpact = async (reason) => {
  if (state.inFlightEventImpact) return;
  state.inFlightEventImpact = true;
  const startedAt = Date.now();
  try {
    const { res, baseUrl, attempt, failure } = await requestEndpoint(
      '/api/finance/event-impact?limit=120',
      35_000,
      3,
    );
    const text = await res.text();
    console.log(
      `[cache-worker] event-impact ${reason} -> ${res.status} (${Date.now() - startedAt}ms) [${baseUrl}] attempt=${attempt}`,
    );
    if (!res.ok) {
      console.warn(
        `[cache-worker] event-impact response failed [type=${failure?.type || 'non_2xx'} status=${res.status}] ${text.slice(0, 300)}`,
      );
    }
  } catch (err) {
    const cls = err?.classification || classifyRequestError(err);
    console.warn(
      `[cache-worker] event-impact failed [type=${cls.type}]`,
      cls.message || err?.message || err,
    );
  } finally {
    state.inFlightEventImpact = false;
  }
};

const warmMacro = async () => {
  if (state.inFlightMacro) return;
  state.inFlightMacro = true;
  try {
    await warmEconomy('macro@21:05');
  } finally {
    state.inFlightMacro = false;
  }
};

const scheduleShanghaiDaily = (label, time, fn) => {
  const scheduleNext = () => {
    const nextMs = nextShanghaiTime(time);
    const delay = Math.max(0, nextMs - Date.now());
    const nextAtShanghai = getShanghaiParts(new Date(nextMs));
    console.log(
      `[cache-worker] scheduled ${label} at ${String(nextAtShanghai.year).padStart(4, '0')}-${String(nextAtShanghai.month).padStart(2, '0')}-${String(nextAtShanghai.day).padStart(2, '0')} ${String(nextAtShanghai.hour).padStart(2, '0')}:${String(nextAtShanghai.minute).padStart(2, '0')} (${Math.round(delay / 1000)}s)`,
    );

    setTimeout(async () => {
      try {
        await fn();
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
};

const scheduleEveryMs = (label, intervalMs, fn, initialDelayMs = 5_000) => {
  setTimeout(async () => {
    while (true) {
      try {
        await fn();
      } catch (err) {
        console.warn(`[cache-worker] ${label} failed:`, err?.message || err);
      }
      await sleep(intervalMs);
    }
  }, initialDelayMs);
};

const main = async () => {
  if (!enabled) {
    console.log('[cache-worker] disabled via CACHE_WORKER_ENABLED=false');
    return;
  }

  console.log('[cache-worker] starting...');
  console.log('[cache-worker] baseUrls:', baseUrls.join(', '));

  const ready = await waitForServer();
  if (!ready) {
    console.warn('[cache-worker] server not ready after timeout; continuing anyway');
  }

  // Startup warm: ensures first public visit is cache-hit most of the time.
  await warmNews('startup');
  await warmEconomy('startup');
  await warmEventImpact('startup');

  // News: strict 07:00 / 13:00 / 19:00 (Asia/Shanghai)
  scheduleShanghaiDaily('news@07:00', { hour: 7, minute: 0 }, async () => {
    await warmNews('slot@07:00');
    await warmEventImpact('slot@07:00');
  });
  scheduleShanghaiDaily('news@13:00', { hour: 13, minute: 0 }, async () => {
    await warmNews('slot@13:00');
    await warmEventImpact('slot@13:00');
  });
  scheduleShanghaiDaily('news@19:00', { hour: 19, minute: 0 }, async () => {
    await warmNews('slot@19:00');
    await warmEventImpact('slot@19:00');
  });

  // Economy market snapshot: keep rolling widgets fresh (10 minutes).
  scheduleEveryMs('economy@10m', 10 * 60 * 1000, () => warmEconomy('interval@10m'));

  // News heartbeat: keep warm logs/health visible and cache hit path active.
  // Actual finance news payload still rotates by 6-hour slot in the API layer.
  scheduleEveryMs('news@10m', 10 * 60 * 1000, () => warmNews('interval@10m'));

  // Event impact matrix: keep this lightweight cache warm for public homepage/modules.
  scheduleEveryMs('event-impact@10m', 10 * 60 * 1000, () => warmEventImpact('interval@10m'));

  // Macro: fixed 21:05 (Asia/Shanghai)
  scheduleShanghaiDaily('macro@21:05', { hour: 21, minute: 5 }, () => warmMacro());

  console.log('[cache-worker] running');
};

if (require.main === module) {
  main().catch((err) => {
    console.error('[cache-worker] fatal:', err);
    process.exitCode = 1;
  });
}

module.exports = {
  buildBaseUrlCandidates,
  classifyRequestError,
};
