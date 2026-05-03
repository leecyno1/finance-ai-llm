'use client';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Monitor, MoonStar, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Theme = 'dark' | 'light' | 'system';

const ThemeSwitcher = ({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) => {
  const [mounted, setMounted] = useState(false);

  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid Hydration Mismatch
  if (!mounted) {
    return null;
  }

  const fullOptions: Array<{
    value: Theme;
    label: string;
    icon: LucideIcon;
  }> = [
    { value: 'system', label: 'Auto', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: MoonStar },
  ];

  const compactOptions: Array<{
    value: Exclude<Theme, 'system'>;
    label: string;
    icon: LucideIcon;
  }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: MoonStar },
  ];

  const activeTheme: Theme =
    theme === 'system'
      ? ((resolvedTheme === 'light' ? 'light' : 'dark') as Theme)
      : ((theme || 'system') as Theme);

  const options = compact ? compactOptions : fullOptions;
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === (compact ? activeTheme : (theme || 'system'))),
  );
  const itemHeight = compact ? 20 : 17;
  const gap = 2;

  return (
    <div className={cn(compact ? 'w-full max-w-[50px]' : 'w-full max-w-[56px]', className)}>
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
              onClick={() => setTheme(opt.value)}
              aria-pressed={(compact ? activeTheme : (theme || 'system')) === opt.value}
                className={cn(
                  'w-full rounded-lg transition-colors duration-200',
                  compact ? 'text-[9px] h-[20px]' : 'text-[8px] h-[17px]',
                  'flex items-center justify-center gap-0.5 font-semibold tracking-normal',
                  (compact ? activeTheme : (theme || 'system')) === opt.value
                    ? 'text-rose-800 dark:text-rose-100 font-bold'
                    : 'text-black/60 dark:text-white/65 hover:text-blue-700 dark:hover:text-blue-200',
                )}
              >
              <opt.icon size={compact ? 10 : 8} />
              {compact ? opt.label.slice(0, 1) : opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThemeSwitcher;
