import fs from 'fs';
import path from 'node:path';
import db from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { getClientIdFromHeaders } from '@/lib/server/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FinanceNewsItem = {
  title: string;
  content: string;
  url: string;
  source: string;
  datetime: string;
  channels?: string;
};

type NewsCache = {
  updatedAt: string;
  items: FinanceNewsItem[];
};

type SuggestedQuestion = {
  id: string;
  question: string;
  fromTitle: string;
  datetime?: string;
};

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const CACHE_PATH = path.join(DATA_DIR, 'data/news-cache.json');

const MAX_HOT = 4;
const MAX_NEWS = 2;
const HISTORY_LOOKBACK = 2000;
const MAGIC_SETTINGS_CODE = '8899174';

const truncate = (text: string, maxLen: number) => {
  const s = (text || '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 3)).trim()}...`;
};

const normalizeForKey = (text: string) =>
  (text || '')
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\s\p{P}\p{S}]+/gu, '');

const stripNoise = (text: string) => {
  let s = (text || '').trim();
  if (!s) return '';
  s = s.split('\n')[0]?.trim() || s;
  s = s.replace(/https?:\/\/\S+/g, '').trim();
  s = s.replace(/\s+/g, ' ').trim();
  return s;
};

const isOperationalOrSensitive = (text: string) => {
  const s = (text || '').toLowerCase().trim();
  if (!s) return true;
  if (s === MAGIC_SETTINGS_CODE) return true;
  if (/^[-_0-9\s]+$/.test(s)) return true;
  if (s.includes('sk-') || s.includes('api key') || s.includes('apikey')) return true;
  if (s.includes('token') && !s.includes('经济') && !s.includes('新闻')) return true;
  if (s.includes('http://') || s.includes('https://')) return true;

  const opsKeywords = [
    'docker',
    '镜像',
    '容器',
    '部署',
    'claw',
    '爪子云',
    'k8s',
    'pod',
    'imagepull',
    'github',
    'git',
    'push',
    'commit',
    'workflow',
    'ci',
    'cd',
    'mcp',
    'playwright',
    'cdp',
    '9222',
    'localhost',
    '端口',
    '报错',
    'bug',
    '修复',
    '调试',
    '设置页面',
    'searxng',
  ];
  return opsKeywords.some((k) => s.includes(k));
};

const readCache = (): NewsCache | null => {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as NewsCache;
    if (!parsed.updatedAt || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const buildHotFallback = (): SuggestedQuestion[] => [
  {
    id: 'hot-1',
    question: '当前市场最大的风险是什么？给一句话判断和建议动作。',
    fromTitle: '高频·风险提示',
  },
  {
    id: 'hot-2',
    question: '如果只选三条新闻讲市场，要怎么说？（每条一句话）',
    fromTitle: '高频·三条新闻速讲',
  },
  {
    id: 'hot-3',
    question: 'A股/美股/港股各看一个核心变量，分别是什么？',
    fromTitle: '高频·跨市场变量',
  },
  {
    id: 'hot-4',
    question: '给我一个今天的执行清单：买/卖/观望，附理由（短句）。',
    fromTitle: '高频·行动清单',
  },
];

const getHotQuestionsFromHistory = async (owner: string): Promise<SuggestedQuestion[]> => {
  try {
    const rows = await db
      .select({
        content: messages.content,
      })
      .from(messages)
      .where(and(eq(messages.role, 'user'), eq(messages.owner, owner)))
      .orderBy(desc(messages.id))
      .limit(HISTORY_LOOKBACK);

    const buckets = new Map<
      string,
      { question: string; count: number; lastIndex: number }
    >();

    rows.forEach((row, index) => {
      const raw = stripNoise(row.content || '');
      if (!raw) return;
      if (raw.length < 6) return;
      if (isOperationalOrSensitive(raw)) return;

      const key = normalizeForKey(raw);
      if (!key || key.length < 4) return;

      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, {
          question: truncate(raw, 80),
          count: 1,
          lastIndex: index,
        });
        return;
      }

      existing.count += 1;
      if (index < existing.lastIndex) {
        existing.lastIndex = index;
        existing.question = truncate(raw, 80);
      }
    });

    const ranked = [...buckets.values()]
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.lastIndex - b.lastIndex;
      })
      .slice(0, MAX_HOT);

    return ranked.map((r, i) => {
      const base = r.question.replace(/[。.!！]+$/g, '').trim();
      const q = base.endsWith('?') || base.endsWith('？') ? base : `${base}？`;
      return {
        id: `hot-${i + 1}`,
        question: q,
        fromTitle: '历史高频',
      };
    });
  } catch (err) {
    console.warn('Failed to compute hot questions from history', err);
    return [];
  }
};

const buildQuestionsFromNews = (items: FinanceNewsItem[]): SuggestedQuestion[] => {
  // 新闻提问（取最新 2 条，用简洁模板）
  const sorted = [...items].sort((a, b) =>
    (b.datetime || '').localeCompare(a.datetime || ''),
  );

  const unique: FinanceNewsItem[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    const rawTitle = (item.title || item.content || '').trim();
    if (!rawTitle) continue;
    const key = rawTitle.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 2) break;
  }

  const templates = [
    (t: string) => `用一句话说清“${t}”，并指出最直接的市场影响。`,
    (t: string) => `基于“${t}”，列 3 个可追问的数据/指标。`,
  ];

  const newsSuggestions: SuggestedQuestion[] = [];
  unique.forEach((item, idx) => {
    if (idx >= Math.min(templates.length, MAX_NEWS)) return;
    const rawTitle = (item.title || item.content || '').trim();
    const title = rawTitle.length > 60 ? `${rawTitle.slice(0, 57)}...` : rawTitle;
    newsSuggestions.push({
      id: `news-${idx}`,
      question: templates[idx](title),
      fromTitle: rawTitle,
      datetime: item.datetime,
    });
  });

  if (newsSuggestions.length) return newsSuggestions;

  return [
    {
      id: 'news-0',
      question: '过去24小时最重要的3条财经快讯是什么？每条一句话影响。',
      fromTitle: '财经快讯·通用',
    },
    {
      id: 'news-1',
      question: '今天最该关注的三个数据/事件是什么？按“时间-事件-影响”列出。',
      fromTitle: '财经快讯·关注清单',
    },
  ].slice(0, MAX_NEWS);
};

export const GET = async (req: Request) => {
  try {
    // suggestions should be user-scoped (same as chat history), based on IP-hashed owner
    const owner = getClientIdFromHeaders(new Headers(req.headers));
    const hotFromHistory = await getHotQuestionsFromHistory(owner);
    const hot = (hotFromHistory.length ? hotFromHistory : buildHotFallback()).slice(
      0,
      MAX_HOT,
    );

    const cache = readCache();

    const newsSuggestions = buildQuestionsFromNews(cache?.items || []);
    const suggestions = [...hot, ...newsSuggestions].slice(0, MAX_HOT + MAX_NEWS);

    if (!cache || !cache.items.length) {
      return Response.json(
        {
          source: hotFromHistory.length ? 'history-fallback' : 'fallback',
          suggestions,
        },
        { status: 200 },
      );
    }

    return Response.json(
      {
        source: hotFromHistory.length ? 'history+cache' : 'cache',
        suggestions,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in /api/news/suggestions route:', err);
    const hot = buildHotFallback().slice(0, MAX_HOT);
    const suggestions = [...hot, ...buildQuestionsFromNews([])].slice(0, MAX_HOT + MAX_NEWS);
    return Response.json(
      {
        source: 'error',
        suggestions,
      },
      { status: 500 },
    );
  }
};
