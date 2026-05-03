import { useEffect, useState } from 'react';
import { buildSummaryHref } from '@/lib/utils/newsSummaryHref';

interface Article {
  title: string;
  content: string;
  url: string;
  thumbnail: string;
}

const getThumbnailSrc = (thumbnail: string | undefined, baseUrl?: string) => {
  if (!thumbnail) return '/dasheng-logo.png';
  const trimmed = thumbnail.trim();
  if (!trimmed) return '/dasheng-logo.png';

  // Allow local API/image paths (e.g. /api/og-image?... or /dasheng-logo.png)
  if (
    trimmed.startsWith('/api/') ||
    trimmed.startsWith('/dr-') ||
    trimmed.startsWith('/mei-')
  ) {
    return trimmed;
  }

  try {
    const resolved = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    return `/api/image-proxy?url=${encodeURIComponent(resolved.toString())}`;
  } catch {
    // protocol-relative URL like //example.com/a.jpg
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    return '/dasheng-logo.png';
  }
};

const NewsArticleWidget = () => {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/discover?mode=preview')
      .then((res) => res.json())
      .then((data) => {
        const articles = (data.blogs || []).filter((a: Article) => a.thumbnail);
        setArticle(articles[Math.floor(Math.random() * articles.length)]);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  return (
    <div className="bg-light-secondary dark:bg-dark-secondary rounded-2xl border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/25 flex flex-row items-stretch w-full h-24 min-h-[96px] max-h-[96px] p-0 overflow-hidden">
      {loading ? (
        <div className="animate-pulse flex flex-row items-stretch w-full h-full">
          <div className="w-24 min-w-24 max-w-24 h-full bg-light-200 dark:bg-dark-200" />
          <div className="flex flex-col justify-center flex-1 px-3 py-2 gap-2">
            <div className="h-4 w-3/4 rounded bg-light-200 dark:bg-dark-200" />
            <div className="h-3 w-1/2 rounded bg-light-200 dark:bg-dark-200" />
          </div>
        </div>
      ) : error ? (
        <div className="w-full text-xs text-red-400">Could not load news.</div>
      ) : article ? (
        <a
          href={buildSummaryHref(article.url, article.title, article.content)}
          className="flex flex-row items-stretch w-full h-full relative overflow-hidden group"
        >
          <div className="relative w-24 min-w-24 max-w-24 h-full overflow-hidden">
            <img
              className="object-cover w-full h-full bg-light-200 dark:bg-dark-200 group-hover:scale-110 transition-transform duration-300 brand-image-highlight"
              src={getThumbnailSrc(article.thumbnail, article.url)}
              alt={article.title}
              onError={(e) => {
                const el = e.currentTarget;
                if (el.dataset.fallbackApplied) return;
                el.dataset.fallbackApplied = '1';
                el.src = '/dasheng-logo.png';
              }}
            />
          </div>
          <div className="flex flex-col justify-center flex-1 px-3 py-2">
            <div className="font-semibold text-xs text-black dark:text-white leading-tight line-clamp-2 mb-1">
              {article.title}
            </div>
            <p className="text-black/60 dark:text-white/60 text-[10px] leading-relaxed line-clamp-2">
              {article.content}
            </p>
          </div>
        </a>
      ) : null}
    </div>
  );
};

export default NewsArticleWidget;
