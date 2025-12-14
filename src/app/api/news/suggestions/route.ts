import fs from 'fs';
import path from 'node:path';

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

const buildQuestionsFromNews = (items: FinanceNewsItem[]): SuggestedQuestion[] => {
  // 历史高频（固定 4 条）
  const hot: SuggestedQuestion[] = [
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
    if (idx >= templates.length) return;
    const rawTitle = (item.title || item.content || '').trim();
    const title = rawTitle.length > 60 ? `${rawTitle.slice(0, 57)}...` : rawTitle;
    newsSuggestions.push({
      id: `news-${idx}`,
      question: templates[idx](title),
      fromTitle: rawTitle,
      datetime: item.datetime,
    });
  });

  const suggestions = [...hot, ...newsSuggestions];

  if (suggestions.length) return suggestions;

  // 兜底
  return [
    {
      id: 'default-1',
      question: '过去24小时最重要的3条财经新闻是什么？各一句话影响。',
      fromTitle: '通用宏观梳理',
    },
    {
      id: 'default-2',
      question: '当前最大的市场风险是什么？一句话提示 + 建议动作。',
      fromTitle: '风险提示',
    },
    {
      id: 'default-3',
      question: '帮我抓3条中国/美国/欧洲的关键事件，各一句话说明影响。',
      fromTitle: '跨市场梳理',
    },
  ];
};

export const GET = async () => {
  try {
    const cache = readCache();

    if (!cache || !cache.items.length) {
      const suggestions = buildQuestionsFromNews([]);
      return Response.json(
        {
          source: 'fallback',
          suggestions,
        },
        { status: 200 },
      );
    }

    const suggestions = buildQuestionsFromNews(cache.items);

    return Response.json(
      {
        source: 'cache',
        suggestions,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in /api/news/suggestions route:', err);
    const suggestions = buildQuestionsFromNews([]);
    return Response.json(
      {
        source: 'error',
        suggestions,
      },
      { status: 500 },
    );
  }
};
