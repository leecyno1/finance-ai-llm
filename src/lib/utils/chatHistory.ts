import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

type HistoryTuple = [string, string];

type HistoryObject = {
  role?: string;
  content?: unknown;
};

const normalizeRole = (role?: string) => {
  const value = (role ?? '').toLowerCase().trim();
  if (value === 'assistant' || value === 'ai') return 'assistant';
  if (value === 'user' || value === 'human') return 'user';
  return null;
};

export const toBaseMessages = (input: unknown): BaseMessage[] => {
  if (!Array.isArray(input)) return [];

  return input
    .map((item): BaseMessage | undefined => {
      if (Array.isArray(item)) {
        const [role, content] = item as HistoryTuple;
        const normalizedRole = normalizeRole(role);
        if (!normalizedRole || typeof content !== 'string' || !content.trim()) {
          return undefined;
        }

        return normalizedRole === 'user'
          ? new HumanMessage(content)
          : new AIMessage(content);
      }

      if (item && typeof item === 'object') {
        const { role, content } = item as HistoryObject;
        const normalizedRole = normalizeRole(role);
        if (!normalizedRole) return undefined;

        const text = typeof content === 'string' ? content : String(content ?? '');
        if (!text.trim()) return undefined;

        return normalizedRole === 'user'
          ? new HumanMessage(text)
          : new AIMessage(text);
      }

      return undefined;
    })
    .filter((msg): msg is BaseMessage => msg !== undefined);
};
