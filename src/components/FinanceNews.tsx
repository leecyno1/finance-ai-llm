'use client';

import { useEffect, useState } from 'react';
import { Clock, ExternalLink, TrendingUp } from 'lucide-react';

type NewsItem = {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  publishTime: string;
  timestamp: number;
  summary?: string;
  importance?: 'high' | 'medium' | 'low';
};

type NewsResponse = {
  success: boolean;
  data: NewsItem[];
  cached?: boolean;
  updatedAt?: number;
  count?: number;
};

const FinanceNews = () => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchNews = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/economy/news');
      const data = (await res.json()) as NewsResponse;

      if (data.success) {
        setNews(data.data);
        setLastUpdate(new Date(data.updatedAt || Date.now()));
        setError(null);
      } else {
        setError('获取新闻失败');
      }
    } catch (err) {
      console.error('Failed to fetch finance news:', err);
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    // 每 5 分钟自动刷新
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;

    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const getImportanceColor = (importance?: string) => {
    switch (importance) {
      case 'high':
        return 'text-red-500 dark:text-red-400';
      case 'medium':
        return 'text-orange-500 dark:text-orange-400';
      default:
        return 'text-blue-500 dark:text-blue-400';
    }
  };

  if (loading && news.length === 0) {
    return (
      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black/70 dark:border-white/70"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 p-6">
        <div className="text-center text-red-500 dark:text-red-400">
          <p>{error}</p>
          <button
            onClick={fetchNews}
            className="mt-4 px-4 py-2 bg-black/10 dark:bg-white/10 rounded-lg hover:bg-black/20 dark:hover:bg-white/20 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-black/80 dark:text-white/80 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          财经快讯
        </h2>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs text-black/50 dark:text-white/50 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {lastUpdate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetchNews}
            disabled={loading}
            className="text-xs px-3 py-1 bg-black/10 dark:bg-white/10 rounded-lg hover:bg-black/20 dark:hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/50 dark:bg-dark-secondary/50 divide-y divide-light-200/40 dark:divide-dark-200/40 max-h-[600px] overflow-y-auto">
        {news.length === 0 ? (
          <div className="p-6 text-center text-black/50 dark:text-white/50">
            暂无财经新闻
          </div>
        ) : (
          news.map((item) => (
            <div
              key={item.id}
              className="p-4 hover:bg-light-200/30 dark:hover:bg-dark-200/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2"
                  >
                    <h3 className="text-sm font-medium text-black/80 dark:text-white/80 group-hover:text-black dark:group-hover:text-white line-clamp-2 flex-1">
                      {item.importance === 'high' && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle"></span>
                      )}
                      {item.title}
                    </h3>
                    <ExternalLink className="w-3 h-3 text-black/30 dark:text-white/30 group-hover:text-black/50 dark:group-hover:text-white/50 flex-shrink-0 mt-0.5" />
                  </a>
                  
                  {item.summary && (
                    <p className="text-xs text-black/50 dark:text-white/50 mt-1 line-clamp-2">
                      {item.summary}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-3 mt-2 text-xs text-black/40 dark:text-white/40">
                    <span className={getImportanceColor(item.importance)}>
                      {item.source}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(item.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FinanceNews;
