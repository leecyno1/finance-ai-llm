'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Lang = 'en' | 'zh';

const LanguageSwitcher = ({ compact = false }: { compact?: boolean }) => {
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

  const options: Array<{ value: Lang; label: string }> = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'EN' },
  ];
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === lang),
  );
  const itemHeight = compact ? 20 : 17;
  const gap = 2;

  return (
    <div className={cn(compact ? 'w-full max-w-[50px]' : 'w-full max-w-[44px]')}>
      <div
        className={cn(
          'relative rounded-xl border p-0.5',
          'border-rose-300/35 dark:border-blue-400/20',
          'bg-gradient-to-b from-light-secondary/95 via-light-secondary to-light-200/70',
          'dark:from-dark-secondary dark:via-dark-secondary dark:to-dark-200/80',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_8px_22px_rgba(6,30,48,0.16)]',
          'dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_10px_24px_rgba(0,0,0,0.35)]',
        )}
      >
        <div
          className="pointer-events-none absolute left-1 right-1 rounded-lg transition-transform duration-300 ease-out"
          style={{
            height: `${itemHeight}px`,
            transform: `translateY(${activeIndex * (itemHeight + gap)}px)`,
          }}
        >
          <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-rose-500/22 to-blue-500/22 dark:from-rose-500/18 dark:to-blue-400/18" />
          <div className="switch-wave absolute left-1 right-1 top-1/2 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-rose-400/35 to-blue-400/35 blur-md dark:from-rose-300/30 dark:to-blue-300/30" />
          <div className="absolute inset-[1px] rounded-lg border border-rose-400/35 dark:border-blue-300/35" />
        </div>

        <div className="relative z-10 flex flex-col gap-0.5">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLanguage(opt.value)}
              aria-pressed={lang === opt.value}
              className={cn(
                'w-full rounded-lg transition-colors duration-200',
                compact ? 'text-[9px] h-[20px]' : 'text-[8px] h-[17px]',
                lang === opt.value
                  ? 'text-rose-800 dark:text-rose-100 font-bold'
                  : 'text-black/60 dark:text-white/65 hover:text-blue-700 dark:hover:text-blue-200',
              )}
            >
              {compact ? (opt.value === 'zh' ? '中' : 'EN') : opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LanguageSwitcher;
