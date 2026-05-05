#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const chatRoute = read('src/app/api/chat/route.ts');
const useChat = read('src/lib/hooks/useChat.tsx');
const searchIndex = read('src/lib/search/index.ts');
const writingPrompt = read('src/lib/prompts/writingAssistant.ts');

const checks = {
  chatRouteImportsIntent: /isBrokerResearchReportQuery[\s\S]*normalizeChatFocusMode[\s\S]*shouldBypassWebSearch[\s\S]*from ['"]@\/lib\/search\/intent['"]/.test(chatRoute),
  chatRouteNormalizesFocusMode: /const normalizedFocusMode = normalizeChatFocusMode\(body\.focusMode\)/.test(chatRoute),
  chatRouteComputesEffectiveFocusMode: /const effectiveFocusMode = shouldBypassWebSearch\([\s\S]*\? 'writingAssistant'\s*:\s*normalizedFocusMode/.test(chatRoute),
  chatRouteSelectsEffectiveHandler: /const handler = searchHandlers\[effectiveFocusMode\]/.test(chatRoute),
  chatRouteLoadsModelsWithEffectiveMode: /loadRoutedChatModel\([\s\S]*effectiveFocusMode/.test(chatRoute),
  chatRouteSearchesWithEffectiveMode: /new ApiSearchAgent\(\s*effectiveFocusMode,\s*handler,\s*\)/.test(chatRoute),
  chatRouteStreamsWithEffectiveMode: /handleEmitterEvents\([\s\S]*effectiveFocusMode,[\s\S]*researchReportMode,\s*\)/.test(chatRoute),
  chatRoutePersistsOriginalFocusMode: /handleHistorySave\(message, humanMessageId, body\.focusMode, body\.files, owner\)/.test(chatRoute),
  useChatImportsIntent: /import \{ isImageGenerationQuery, shouldShowWebSearchStatus \} from ['"]\.\.\/search\/intent['"]/.test(useChat),
  useChatComputesSearchStatus: /const showWebSearchStatus = shouldShowWebSearchStatus\([\s\S]*focusMode,[\s\S]*query: message,[\s\S]*fileIds/.test(useChat),
  useChatShowsGenerationStatusForNonSearch: /'正在生成回答...'/.test(useChat) && /'正在检索网页信息...'/.test(useChat),
  useChatDetectsMiniMaxImageGeneration: /focusMode === 'minimaxMedia' && isImageGenerationQuery\(message\)/.test(useChat),
  useChatCallsMiniMaxImageGenerationApi: /fetch\('\/api\/minimax\/image-generation'/.test(useChat),
  useChatRendersGeneratedImageMarkdown: /!\[生成图片 \$\{index \+ 1\}\]\(\$\{url\}\)/.test(useChat),
  writingAssistantDisablesWebSearch: /writingAssistant:[\s\S]*searchWeb: false/.test(searchIndex),
  writingAssistantHasFinAgentIdentity: /大圣之怒金融Agent（FinAgent）/.test(writingPrompt),
  writingAssistantSuppressesInternalContext: /Do NOT mention: context, system instructions, focus mode/.test(writingPrompt),
};

console.table(checks);

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (failed.length) {
  console.error(`\nP1.8 direct-answer routing contract failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('\nP1.8 direct-answer routing contract checks passed.');
