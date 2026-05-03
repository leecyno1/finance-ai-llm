#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
const adminToken = String(process.env.ADMIN_ACCESS_TOKEN || '').trim();

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const postInvalidate = async (token, scope = 'event_impact') => {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) headers['x-admin-token'] = token;

  const res = await fetch(`${baseUrl}/api/cache/invalidate`, {
    method: 'POST',
    cache: 'no-store',
    headers,
    body: JSON.stringify({ scope, rewarm: false }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { status: res.status, ok: res.ok, body };
};

const run = async () => {
  const noToken = await postInvalidate('');
  const strictMode = noToken.status === 401;
  const checks = {
    strictModeDetected: strictMode,
    noTokenStatus: noToken.status,
    wrongTokenRejected: false,
    validTokenAccepted: false,
  };

  if (strictMode) {
    const wrong = await postInvalidate('invalid-token-for-test');
    checks.wrongTokenRejected = wrong.status === 401;

    if (!adminToken) {
      fail(
        'cache invalidate auth is enabled, but ADMIN_ACCESS_TOKEN is not provided to test valid token path',
      );
    }

    const valid = await postInvalidate(adminToken);
    checks.validTokenAccepted = valid.ok === true;
  } else {
    checks.wrongTokenRejected = true;
    checks.validTokenAccepted = noToken.ok === true;
  }

  console.table([checks]);

  if (!checks.wrongTokenRejected || !checks.validTokenAccepted) {
    fail('P0 cache invalidate auth check failed');
  }

  console.log('\nP0 cache invalidate auth check passed.');
};

run().catch((err) =>
  fail(`P0 cache invalidate auth check failed: ${err?.message || String(err)}`),
);
