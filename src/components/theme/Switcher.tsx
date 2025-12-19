'use client';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Theme = 'dark' | 'light' | 'system';

const ThemeSwitcher = ({ className }: { className?: string }) => {
  const [mounted, setMounted] = useState(false);

  const { theme, setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid Hydration Mismatch
  if (!mounted) {
    return null;
  }

  const currentTheme = (theme || 'system') as Theme;
  const activeText =
    currentTheme === 'system'
      ? `System (${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`
      : currentTheme === 'dark'
        ? 'Dark'
        : 'Light';

  const itemClass = (isActive: boolean) =>
    cn(
      'flex items-center justify-center gap-1 rounded-lg px-2 py-1.5',
      'text-[10px] font-medium border transition-colors',
      isActive
        ? 'bg-light-200 dark:bg-dark-200 border-light-300/70 dark:border-dark-100/70 text-black/80 dark:text-white/80'
        : 'bg-light-primary/70 dark:bg-dark-primary/70 border-light-200/70 dark:border-dark-200/70 text-black/60 dark:text-white/60 hover:bg-light-200 hover:dark:bg-dark-200',
    );

  return (
    <div
      className={cn(
        'w-full rounded-2xl border border-light-200 dark:border-dark-200 bg-light-primary/60 dark:bg-dark-primary/60 px-2 py-2',
        className,
      )}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-semibold text-black/60 dark:text-white/60">
          Theme
        </span>
        <span className="text-[10px] text-black/40 dark:text-white/40">
          {activeText}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          className={itemClass(currentTheme === 'system')}
          onClick={() => setTheme('system')}
          aria-label="Theme: System"
        >
          <Monitor className="h-3.5 w-3.5" />
          System
        </button>
        <button
          type="button"
          className={itemClass(currentTheme === 'light')}
          onClick={() => setTheme('light')}
          aria-label="Theme: Light"
        >
          <Sun className="h-3.5 w-3.5" />
          Light
        </button>
        <button
          type="button"
          className={itemClass(currentTheme === 'dark')}
          onClick={() => setTheme('dark')}
          aria-label="Theme: Dark"
        >
          <Moon className="h-3.5 w-3.5" />
          Dark
        </button>
      </div>
    </div>
  );
};

export default ThemeSwitcher;
