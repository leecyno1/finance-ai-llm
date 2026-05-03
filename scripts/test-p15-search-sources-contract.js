#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/lib/search/metaSearchAgent.ts');
const text = fs.readFileSync(file, 'utf8');

const checks = {
  hasSourceEmitterType: text.includes('type SourceEmitter ='),
  hasSafeEmitSources: text.includes('const safeEmitSources'),
  createAnsweringAcceptsEmitter: /createAnsweringChain\([\s\S]*sourceEmitter\?: SourceEmitter/.test(text),
  rerankEmitsDocuments: /sourceEmitter\?\.\(sortedDocs\)/.test(text),
  handleStreamGuardsSourceShape: /Array\.isArray\(event\.data\?\.output\)/.test(text),
  searchAndAnswerUsesSingleEmit: /let sourcesEmitted = false/.test(text),
};

console.table(checks);

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (failed.length > 0) {
  console.error(`\nP1.5 search sources contract failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('\nP1.5 search sources contract checks passed.');
