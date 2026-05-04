const stripPunctuation = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[?？!！。.,，:：;；~～`'"“”‘’()（）\[\]【】{}<>《》]/g, '');

const DIRECT_ANSWER_EXACT = new Set([
  '你是谁',
  '你是什么',
  '你叫什么',
  '介绍你自己',
  '介绍一下你自己',
  '自我介绍',
  '你能做什么',
  '你可以做什么',
  '你会做什么',
  '你的功能',
  '帮助',
  'help',
  'whoareyou',
  'whatareyou',
  'whatcanyoudo',
  'introduceyourself',
  'hello',
  'hi',
  'hey',
  '你好',
  '您好',
  '谢谢',
  'thanks',
  'thankyou',
  '好的',
  '好',
  'ok',
]);

const DIRECT_ANSWER_PATTERNS = [
  /^你是(谁|什么|哪个模型|什么模型|ai|人工智能|机器人)$/,
  /^请?(简单)?介绍(一下)?你自己$/,
  /^说(一下|说)你(能|可以|会)做什么$/,
  /^whoareyou$/,
  /^whatcanyoudo$/,
];

const SEARCH_INTENT_PATTERN =
  /搜索|检索|查找|查询|联网|新闻|最新|今天|今日|现在|实时|网页|来源|引用|search|lookup|latest|today|news|source|cite|web/i;

export const isDirectAnswerQuery = (query: string) => {
  const normalized = stripPunctuation(query);
  if (!normalized || normalized.length > 40) return false;
  if (SEARCH_INTENT_PATTERN.test(query)) return false;
  return (
    DIRECT_ANSWER_EXACT.has(normalized) ||
    DIRECT_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

export const shouldBypassWebSearch = ({
  focusMode,
  query,
  fileIds,
}: {
  focusMode: string;
  query: string;
  fileIds?: string[];
}) =>
  focusMode === 'webSearch' &&
  (!fileIds || fileIds.length === 0) &&
  isDirectAnswerQuery(query);
