const CODE_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)```/gi;

const unique = (arr: string[]) => Array.from(new Set(arr));

const extractBetween = (text: string, open: string, close: string) => {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

const parseCandidate = <T = unknown>(candidate: string): T | null => {
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
};

/**
 * Parse JSON-like payloads that may include wrappers like code fences, `data:`,
 * or extra text before/after the JSON block.
 */
export const parseLooseJson = <T = unknown>(raw: unknown): T | null => {
  if (typeof raw !== 'string') return null;

  const text = raw.trim();
  if (!text) return null;

  const candidates: string[] = [text];

  const withoutDataPrefix = text.replace(/^\s*data:\s*/i, '').trim();
  if (withoutDataPrefix && withoutDataPrefix !== text) {
    candidates.push(withoutDataPrefix);
  }

  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = CODE_FENCE_REGEX.exec(text)) !== null) {
    if (fenceMatch[1]?.trim()) {
      candidates.push(fenceMatch[1].trim());
    }
  }

  const objectFragment = extractBetween(text, '{', '}');
  if (objectFragment) candidates.push(objectFragment.trim());

  const arrayFragment = extractBetween(text, '[', ']');
  if (arrayFragment) candidates.push(arrayFragment.trim());

  for (const candidate of unique(candidates)) {
    const parsed = parseCandidate<T>(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
};
