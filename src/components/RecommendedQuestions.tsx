'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@/lib/hooks/useChat';
import { cn } from '@/lib/utils';

type SuggestedQuestion = {
  id: string;
  question: string;
  fromTitle: string;
  datetime?: string;
};

const RecommendedQuestions = () => {
  const { sendMessage } = useChat();
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const res = await fetch('/api/news/suggestions');
        if (!res.ok) {
          throw new Error(`Failed to load suggestions: ${res.status}`);
        }
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch (err) {
        console.error('Failed to load suggested questions', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, []);

  if (loading || !suggestions.length) {
    return null;
  }

  const handleClick = (q: string) => {
    // 直接用推荐问题发起一次对话
    sendMessage(q);
  };

  return (
    <div className="w-full rounded-2xl border border-light-200 dark:border-dark-200 bg-light-secondary/60 dark:bg-dark-secondary/60 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-black/70 dark:text-white/70">
          推荐提问
        </p>
        <p className="text-[10px] text-black/40 dark:text-white/40">
          基于最新财经快讯自动生成
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handleClick(s.question)}
            className={cn(
              'text-[11px] px-2.5 py-1.5 rounded-full border',
              'border-light-200/70 dark:border-dark-200/70',
              'bg-light-primary/80 dark:bg-dark-primary/80',
              'text-black/75 dark:text-white/75',
              'hover:bg-light-200 hover:dark:bg-dark-200',
              'hover:border-light-300/80 hover:dark:border-dark-100/80',
              'transition-colors duration-150 text-left',
            )}
          >
            {s.question}
          </button>
        ))}
      </div>
    </div>
  );
};

export default RecommendedQuestions;

