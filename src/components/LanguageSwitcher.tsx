'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Lang = 'en' | 'zh';

const LanguageSwitcher = () => {
  const [lang, setLang] = useState<Lang>('zh');

  useEffect(() => {
    try {
      const stored =
        typeof window !== 'undefined'
          ? (localStorage.getItem('language') as Lang | null)
          : null;
      if (stored === 'en' || stored === 'zh') {
        setLang(stored);
      }
    } catch {
      // ignore read errors, fall back to default
    }
  }, []);

  const setLanguage = (value: Lang) => {
    setLang(value);
    try {
      localStorage.setItem('language', value);
      // Reuse the same event used by other client config helpers so
      // components can react to language changes.
      window.dispatchEvent(new Event('client-config-changed'));
    } catch {
      // ignore write errors
    }
  };

  return (
    <div className="w-full rounded-2xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/60 px-2 py-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-semibold text-black/60 dark:text-white/60">
          Language
        </span>
        <span className="text-[10px] text-black/40 dark:text-white/40">
          {lang === 'zh' ? '中文' : 'English'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => setLanguage('zh')}
          className={cn(
            'rounded-lg px-2 py-1.5 text-[10px] font-medium border transition-colors',
            lang === 'zh'
              ? 'bg-light-200 dark:bg-dark-200 border-light-300/70 dark:border-dark-100/70 text-black/80 dark:text-white/80'
              : 'bg-light-primary/70 dark:bg-dark-primary/70 border-light-200/70 dark:border-dark-200/70 text-black/60 dark:text-white/60 hover:bg-light-200 hover:dark:bg-dark-200',
          )}
          aria-label="Language: 中文"
        >
          中文
        </button>
        <button
          type="button"
          onClick={() => setLanguage('en')}
          className={cn(
            'rounded-lg px-2 py-1.5 text-[10px] font-medium border transition-colors',
            lang === 'en'
              ? 'bg-light-200 dark:bg-dark-200 border-light-300/70 dark:border-dark-100/70 text-black/80 dark:text-white/80'
              : 'bg-light-primary/70 dark:bg-dark-primary/70 border-light-200/70 dark:border-dark-200/70 text-black/60 dark:text-white/60 hover:bg-light-200 hover:dark:bg-dark-200',
          )}
          aria-label="Language: English"
        >
          EN
        </button>
      </div>
    </div>
  );
};

export default LanguageSwitcher;
