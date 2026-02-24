/* eslint-disable no-console */

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
      headers: { 'user-agent': 'finance-ai-llm/cache-worker' },
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
};

const baseUrl = process.env.CACHE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const enabled = (process.env.CACHE_WORKER_ENABLED || 'true').toLowerCase() !== 'false';

const state = {
  inFlightNews: false,
  inFlightEconomy: false,
  inFlightMacro: false,
  inFlightEventImpact: false,
};

const waitForServer = async () => {
  const maxWaitMs = 90_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/api/config`, 5000);
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
    const res = await fetchWithTimeout(`${baseUrl}/api/news/finance`, 25_000);
    const text = await res.text();
    console.log(
      `[cache-worker] news ${reason} -> ${res.status} (${Date.now() - startedAt}ms)`,
    );
    if (!res.ok) console.warn('[cache-worker] news response:', text.slice(0, 300));
  } catch (err) {
    console.warn('[cache-worker] news failed:', err?.message || err);
  } finally {
    state.inFlightNews = false;
  }
};

const warmEconomy = async (reason) => {
  if (state.inFlightEconomy) return;
  state.inFlightEconomy = true;
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/economy/summary`, 60_000);
    const text = await res.text();
    console.log(
      `[cache-worker] economy ${reason} -> ${res.status} (${Date.now() - startedAt}ms)`,
    );
    if (!res.ok) console.warn('[cache-worker] economy response:', text.slice(0, 300));
  } catch (err) {
    console.warn('[cache-worker] economy failed:', err?.message || err);
  } finally {
    state.inFlightEconomy = false;
  }
};

const warmEventImpact = async (reason) => {
  if (state.inFlightEventImpact) return;
  state.inFlightEventImpact = true;
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/finance/event-impact?limit=120`, 35_000);
    const text = await res.text();
    console.log(
      `[cache-worker] event-impact ${reason} -> ${res.status} (${Date.now() - startedAt}ms)`,
    );
    if (!res.ok) {
      console.warn('[cache-worker] event-impact response:', text.slice(0, 300));
    }
  } catch (err) {
    console.warn('[cache-worker] event-impact failed:', err?.message || err);
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
  console.log('[cache-worker] baseUrl:', baseUrl);

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

  // Event impact matrix: keep this lightweight cache warm for public homepage/modules.
  scheduleEveryMs('event-impact@10m', 10 * 60 * 1000, () => warmEventImpact('interval@10m'));

  // Macro: fixed 21:05 (Asia/Shanghai)
  scheduleShanghaiDaily('macro@21:05', { hour: 21, minute: 5 }, () => warmMacro());

  console.log('[cache-worker] running');
};

main().catch((err) => {
  console.error('[cache-worker] fatal:', err);
  process.exitCode = 1;
});
