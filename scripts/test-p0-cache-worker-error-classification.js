#!/usr/bin/env node

const { classifyRequestError } = require('./cache-worker');

const cases = [
  {
    name: 'abort timeout',
    input: { name: 'AbortError', message: 'The operation was aborted' },
    expected: 'network_timeout',
  },
  {
    name: 'dns error',
    input: { message: 'getaddrinfo ENOTFOUND api.example.com' },
    expected: 'dns',
  },
  {
    name: 'network refused',
    input: { message: 'connect ECONNREFUSED 127.0.0.1:3000' },
    expected: 'network',
  },
  {
    name: 'parse error',
    input: { message: 'Unexpected token < in JSON at position 0' },
    expected: 'parse',
  },
];

const result = {};
let hasFailed = false;

for (const testCase of cases) {
  const actual = classifyRequestError(testCase.input);
  const passed = actual.type === testCase.expected;
  result[testCase.name] = passed;
  if (!passed) {
    hasFailed = true;
    console.error(
      `[fail] ${testCase.name}: expected=${testCase.expected} actual=${actual.type}`,
    );
  }
}

console.table(result);

if (hasFailed) {
  process.exit(1);
}

console.log('\nP0 cache worker error classification check passed.');
