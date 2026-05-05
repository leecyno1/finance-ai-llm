#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.join(process.cwd(), 'src/lib/search/intent.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
});

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
};
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled.outputText, sandbox, { filename: sourcePath });

const {
  isDirectAnswerQuery,
  isImageGenerationQuery,
  normalizeChatFocusMode,
  shouldBypassWebSearch,
  shouldShowWebSearchStatus,
} = sandbox.module.exports;
const errors = [];
const must = (condition, message) => {
  if (!condition) errors.push(message);
};

const directQueries = [
  '你是谁',
  '介绍一下你自己',
  '你能做什么？',
  'hello',
  'What can you do?',
];

for (const query of directQueries) {
  must(isDirectAnswerQuery(query), `Expected direct answer query: ${query}`);
  must(
    shouldBypassWebSearch({ focusMode: 'webSearch', query, fileIds: [] }),
    `Expected webSearch bypass for: ${query}`,
  );
}

const searchQueries = [
  '今天英伟达股价最新消息',
  '搜索一下你是谁写的这篇文章',
  'latest CPI news today',
  '请总结 https://example.com/news',
];

for (const query of searchQueries) {
  must(!isDirectAnswerQuery(query), `Expected search intent query: ${query}`);
  must(
    !shouldBypassWebSearch({ focusMode: 'webSearch', query, fileIds: [] }),
    `Expected no bypass for search query: ${query}`,
  );
}

must(
  !shouldBypassWebSearch({
    focusMode: 'webSearch',
    query: '你是谁',
    fileIds: ['uploaded-file-id'],
  }),
  'Expected file-attached direct query to keep webSearch context',
);

must(
  !shouldBypassWebSearch({ focusMode: 'writingAssistant', query: '你是谁', fileIds: [] }),
  'Expected non-webSearch focus mode to remain unchanged',
);

must(
  normalizeChatFocusMode('minimaxMedia') === 'writingAssistant',
  'Expected minimaxMedia chat submissions to fall back to writingAssistant',
);

must(
  !shouldShowWebSearchStatus({ focusMode: 'minimaxMedia', query: '你是谁', fileIds: [] }),
  'Expected minimaxMedia chat submissions to show generation status, not web search status',
);

must(
  shouldShowWebSearchStatus({
    focusMode: 'webSearch',
    query: '今天英伟达股价最新消息',
    fileIds: [],
  }),
  'Expected real web search queries to show web search status',
);

must(
  isImageGenerationQuery('生成一张芭蕾舞图片'),
  'Expected Chinese image generation prompt to be detected',
);

must(
  isImageGenerationQuery('generate a ballet poster'),
  'Expected English image generation prompt to be detected',
);

console.table({
  directCases: directQueries.length,
  searchCases: searchQueries.length,
  source: sourcePath,
});

if (errors.length) {
  console.error('\nDirect-answer intent contract failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('\nDirect-answer intent contract passed.');
