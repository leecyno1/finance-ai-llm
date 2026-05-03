const TOOL_BLOCK = /<tool_code>[\s\S]*?<\/tool_code>/gi;
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const XML_TAGS = /<\/?(analysis|tool|reasoning|scratchpad)>/gi;
const TOOL_HASH_BLOCK = /\{[\s\S]*?tool\s*=>[\s\S]*?args\s*=>[\s\S]*?\}/gi;

const META_LINE = /^(用户询问|用户问的是|用户的问题|我(?:来|将|要|会|需|需要)|让我|根据我收到|首先|其次|最后|\d+[\.、]|-\s*(用户|我)|the user|i(?:'ll| will| can| should| need)|let me|first,|second,|based on (the )?(search results|context)|looking at the context|from the context)/i;

const META_LINE_ANYWHERE =
  /(the context already|looking at the context|i cannot actually browse|i can(?:not|'t) (?:browse|access)|however, i notice|wait, i need to|let me (?:work|provide|summarize|search)|i should (?:search|analyze|provide)|\bfocus mode\b|writing assistant|system instructions|context\b|according to (?:the )?(?:instructions|policy)|\bpolicy\b|i should not|i shouldn't|i need to|i (?:do not|don't) have (?:real[- ]?time|live) data)/i;

const META_LINE_ANYWHERE_ZH =
  /(基于(?:以上)?(?:指令|要求)|根据(?:以上)?(?:指令|要求)|用户(?:要求|用中文问)|我(?:应该|不应该|需要|不能)|不要(?:做|进行).*?网络搜索|不(?:执行|进行)网络搜索|不会(?:进行|执行)网络搜索|我(?:没有|也没有).*?(?:实时|最新).*(?:数据|信息)|作为(?:写作助手|助手)|焦点模式|上下文(?:为空|是空)|用户问的是|用户的问题|我被设定为|这(?:是|属于)一个.*?(?:问题|请求).*?(?:但是|因此))/i;

const THINKING_LINE =
  /^\s*(?:>\s*)?\[?(?:推理|思考|reasoning|thinking)\]?[：: ]?.*$/gim;
const TOOL_CALL_LINE = /^\s*.*(?:tool\s*=>|args\s*=>).*$\n?/gim;
const WE_CAN_ANSWER_LINE =
  /^\s*(?:we can answer|i can answer|here'?s (?:an?|the) answer)\s*[:：].*$/gim;

const removeMetaNarrationLines = (text: string): string => {
  const lines = text.split('\n');
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].replace(/^\s*>\s*/, '').trim();

    // Handle providers splitting "用户问的是…" across lines ("用户问" + "的是…").
    if (t === '用户问' || t === '用户用' || t === '用户用中文问') {
      const next = (lines[i + 1] ?? '').trim();
      if (next.startsWith('的是')) {
        i += 1;
        continue;
      }
      continue;
    }

    if (t.startsWith('的是哪个') || t.startsWith('的是') && t.length <= 40) {
      continue;
    }

    if (t === '[推理]' || t === '推理' || t === '思考') {
      continue;
    }

    if (META_LINE_ANYWHERE.test(t) || META_LINE_ANYWHERE_ZH.test(t)) continue;
    kept.push(lines[i]);
  }

  return kept.join('\n');
};

const trimMetaPrefixBeforeHeading = (text: string): string => {
  const headingIndex = text.indexOf('## ');
  if (headingIndex <= 0) return text;

  const prefix = text.slice(0, headingIndex);
  if (!prefix.trim()) return text.slice(headingIndex);

  if (
    META_LINE_ANYWHERE.test(prefix) ||
    META_LINE_ANYWHERE_ZH.test(prefix) ||
    /\b(wait,|let me|context|instructions|i don't have|i do not have)\b/i.test(
      prefix,
    )
  ) {
    return text.slice(headingIndex).trim();
  }

  return text;
};

const trimLeadingMetaNarration = (text: string): string => {
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith('#')) break;

    const hasChinese = /[\u4e00-\u9fff]/.test(line);
    const isAsciiBullet = /^[-*]\s+/.test(line) && !hasChinese;

    if (isAsciiBullet || META_LINE.test(line)) {
      i += 1;
      continue;
    }

    break;
  }

  if (i === 0) return text.trim();
  return lines.slice(i).join('\n').trim();
};

const trimDanglingLeadFragment = (text: string): string => {
  const lines = text.split('\n');
  const nonEmptyIdx = lines
    .map((line, idx) => ({ line: line.trim(), idx }))
    .filter((x) => x.line.length > 0)
    .slice(0, 4);
  if (!nonEmptyIdx.length) return text.trim();

  const danglingPrefix =
    /^(但是|不过|然而|因此|所以|另外|然后|Then|However|But)(\s|,|，|:|：|$)/i;
  nonEmptyIdx.forEach(({ line, idx }) => {
    if (
      danglingPrefix.test(line) &&
      line.length <= 32 &&
      !/[。！？!?]$/.test(line)
    ) {
      lines.splice(idx, 1, '');
    }
  });

  return lines.join('\n').trim();
};

export const sanitizeLlmOutput = (raw: string): string => {
  if (!raw) return '';

  let text = raw;

  // Never expose chain-of-thought in final UI.
  text = text.replace(THINK_BLOCK, '');
  // During streaming, hide incomplete <think> blocks before </think> arrives.
  text = text.replace(/<think>[\s\S]*$/gi, '');
  text = text.replace(/<\/?think>/gi, '');
  text = text.replace(TOOL_BLOCK, '');
  text = text.replace(XML_TAGS, '');
  text = text.replace(TOOL_HASH_BLOCK, '');
  text = text.replace(TOOL_CALL_LINE, '');
  text = text.replace(WE_CAN_ANSWER_LINE, '');
  text = text.replace(THINKING_LINE, '');

  // Some providers emit standalone chain-of-thought markers.
  text = text.replace(/<tool_code>/gi, '').replace(/<\/tool_code>/gi, '');

  // Remove incomplete internal blocks during streaming, so hidden reasoning
  // is not leaked before closing tags arrive.
  text = text.replace(/<tool_code>[\s\S]*$/gi, '');

  // Normalize whitespace for better streaming diff stability.
  text = removeMetaNarrationLines(text);
  text = trimMetaPrefixBeforeHeading(text);
  text = trimLeadingMetaNarration(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  // Keep model reasoning prefixes instead of aggressively deleting them.
  text = trimDanglingLeadFragment(text);

  return text;
};
