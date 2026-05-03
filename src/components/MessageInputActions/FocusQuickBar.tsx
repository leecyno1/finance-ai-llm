import { useMemo } from 'react';
import { useChat } from '@/lib/hooks/useChat';
import { cn } from '@/lib/utils';
import { focusModes, quickFocusModeKeys } from './Focus';

interface FocusQuickActionsProps {
  className?: string;
}

const QUICK_HINT_TEXT: Record<string, string> = {
  minimaxMedia: '多模态：支持识图理解、图片生成等多模态能力。',
  academicSearch: 'Academic：检索学术文献并生成结构化研究综述。',
  writingAssistant: 'Writing：仅写作模式，不联网检索，适合润色、改写、结构化输出。',
};

const FocusQuickBar = ({ className }: FocusQuickActionsProps) => {
  const { focusMode, setFocusMode } = useChat();

  const quickModes = useMemo(
    () =>
      focusModes.filter((mode) =>
        (quickFocusModeKeys as readonly string[]).includes(String(mode.key)),
      ),
    [],
  );

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {quickModes.map((mode) => (
        <button
          key={mode.key}
          type="button"
          onClick={() => setFocusMode(mode.key)}
          className={cn(
            'inline-flex items-center justify-center rounded-lg p-2 transition',
            focusMode === mode.key
              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
              : 'text-black/55 hover:bg-light-200 hover:text-black dark:text-white/55 dark:hover:bg-dark-200 dark:hover:text-white',
          )}
          title={mode.title}
          aria-label={`切换到${mode.title}`}
        >
          {mode.icon}
        </button>
      ))}
    </div>
  );
};

export const FocusQuickHint = ({ className }: { className?: string }) => {
  const { focusMode } = useChat();

  const activeMode = focusModes.find(
    (mode) =>
      (quickFocusModeKeys as readonly string[]).includes(String(mode.key)) &&
      mode.key === focusMode,
  );

  if (!activeMode) return null;

  return (
    <div
      className={cn(
        'rounded-xl border border-light-200 dark:border-dark-200 bg-light-primary/75 dark:bg-dark-primary/55 px-3 py-2',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-black dark:text-white">
        <span className="text-rose-600 dark:text-rose-300">{activeMode.icon}</span>
        <span className="text-xs font-semibold">{activeMode.title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-black/70 dark:text-white/70">
        {QUICK_HINT_TEXT[activeMode.key] || activeMode.description}
      </p>
    </div>
  );
};

export default FocusQuickBar;
