#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sourcePath = path.join(root, 'src/lib/search/intent.ts');
const compiled = ts.transpileModule(read('src/lib/search/intent.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
});
const sandbox = { exports: {}, module: { exports: {} }, require };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled.outputText, sandbox, { filename: sourcePath });

const chatRoute = read('src/app/api/chat/route.ts');
const metaAgent = read('src/lib/search/metaSearchAgent.ts');
const messageBox = read('src/components/MessageBox.tsx');
const openaiProvider = read('src/lib/models/providers/openai.ts');
const minimaxProvider = read('src/lib/models/providers/minimax.ts');

const { isBrokerResearchReportQuery } = sandbox.module.exports;
const checks = {
  detectsBrokerReportChinese: isBrokerResearchReportQuery?.('以券商研报形式，写一篇中际旭创最新的分析报告') === true,
  detectsBrokerReportEnglish: isBrokerResearchReportQuery?.('write an institutional equity research report on Nvidia') === true,
  routeAddsInstitutionalReportInstructions: /机构研报|券商研报|不少于\s*5000|5000\s*字|财务分析|估值/.test(chatRoute),
  routeMentionsDataPackGrounding: /researchDataPack|数据包|TuShare|akshare|不得编造|缺失数据/.test(chatRoute),
  routeHasLongReportCompletionCheck: /MIN_RESEARCH_REPORT_CHARS|ensureCompleteResearchReport|responseChars|continued/.test(chatRoute),
  routeEmitsCompletedStatus: /研究过程已完成|type:\s*'statusComplete'|statusComplete/.test(chatRoute),
  metaGuardLongEnough: /STREAM_GUARD_TIMEOUT_MS\s*=\s*(?:9\d{4}|[1-9]\d{5,})/.test(metaAgent),
  providersUseLongTimeoutOrMaxTokens: /timeout:\s*(?:9\d{4}|[1-9]\d{5,})|maxTokens|maxCompletionTokens/.test(openaiProvider + minimaxProvider),
  statusUiHasCompletedState: /研究过程已完成|isStatusCompleted|statusCompleted|animate-pulse/.test(messageBox),
};

console.table(checks);
const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
if (failed.length) {
  console.error(`\nP1.9 research report quality contract failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nP1.9 research report quality contract checks passed.');
