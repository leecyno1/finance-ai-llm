#!/usr/bin/env node

const { execSync } = require('node:child_process');

const service = process.env.DOCKER_SERVICE || 'perplexica';
const since = process.env.LOG_SINCE || '20m';

const readLogs = () => {
  try {
    return execSync(`docker compose logs --since ${since} ${service}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stdout = error?.stdout?.toString?.() || '';
    const stderr = error?.stderr?.toString?.() || '';
    throw new Error(`failed to read docker logs: ${stdout}\n${stderr}`.trim());
  }
};

const logs = readLogs();

const checks = {
  hasNewsWarm200: /\[cache-worker\]\s+news\s+.*->\s+200\b/i.test(logs),
  hasEconomyWarm200: /\[cache-worker\]\s+economy\s+.*->\s+200\b/i.test(logs),
  hasEventImpactWarm200:
    /\[cache-worker\]\s+event-impact\s+.*->\s+200\b/i.test(logs),
};

console.table(checks);

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

if (failed.length > 0) {
  console.error(`\nP0 cache-worker warm log check failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('\nP0 cache-worker warm log check passed.');
