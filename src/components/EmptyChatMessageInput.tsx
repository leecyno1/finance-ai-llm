import { ArrowRight } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import Focus from './MessageInputActions/Focus';
import Optimization from './MessageInputActions/Optimization';
import Attach from './MessageInputActions/Attach';
import { useChat } from '@/lib/hooks/useChat';
import ModelSelector from './MessageInputActions/ChatModelSelector';
import { getLanguage } from '@/lib/config/clientRegistry';
import FocusQuickBar, {
  FocusQuickHint,
} from './MessageInputActions/FocusQuickBar';

const EmptyChatMessageInput = () => {
  const { sendMessage } = useChat();

  /* const [copilotEnabled, setCopilotEnabled] = useState(false); */
  const [message, setMessage] = useState('');
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );
  const composingRef = useRef(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);


  const submitMessage = () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (trimmed === '8899174') {
      try {
        const next = localStorage.getItem('showSettings') === 'true' ? 'false' : 'true';
        localStorage.setItem('showSettings', next);
        window.dispatchEvent(new Event('settings-button-revealed'));
      } catch {}
      setMessage('');
      return;
    }

    sendMessage(message);
    setMessage('');
  };

  const isImeComposing = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    return composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;

      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.hasAttribute('contenteditable');

      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    inputRef.current?.focus();

    const updateLanguage = () => {
      setLanguage(
        ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh') as 'en' | 'zh',
      );
    };

    window.addEventListener('client-config-changed', updateLanguage);
    window.addEventListener('storage', updateLanguage);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('client-config-changed', updateLanguage);
      window.removeEventListener('storage', updateLanguage);
    };
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (composingRef.current) return;
        submitMessage();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (isImeComposing(e)) return;
          e.preventDefault();
          submitMessage();
        }
      }}
      className="w-full"
    >
      <div className="flex flex-col bg-light-secondary dark:bg-dark-secondary px-3 pt-5 pb-3 rounded-2xl w-full border border-light-200 dark:border-dark-200 shadow-sm shadow-light-200/10 dark:shadow-black/20 transition-all duration-200 focus-within:border-light-300 dark:focus-within:border-dark-300">
        <TextareaAutosize
          ref={inputRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          minRows={2}
          className="px-2 bg-transparent placeholder:text-[15px] placeholder:text-black/50 dark:placeholder:text-white/50 text-sm text-black dark:text-white resize-none focus:outline-none w-full max-h-24 lg:max-h-36 xl:max-h-48"
          placeholder={
            language === 'zh' ? '问我任何问题……' : 'Ask anything...'
          }
        />
        <div className="flex flex-row items-center justify-between mt-4">
          <Optimization />
          <div className="flex flex-row items-center space-x-2">
            <div className="flex flex-row items-center space-x-1">
              <ModelSelector />
              <Focus />
              <FocusQuickBar />
              <Attach />
            </div>
            <button
              disabled={message.trim().length === 0}
              className="bg-rose-500 text-white disabled:text-black/50 dark:disabled:text-white/50 disabled:bg-[#e0e0dc] dark:disabled:bg-[#ececec21] hover:bg-rose-600 transition duration-100 rounded-full p-2"
            >
              <ArrowRight className="bg-background" size={17} />
            </button>
          </div>
        </div>
        <FocusQuickHint className="mt-2" />
      </div>
    </form>
  );
};

export default EmptyChatMessageInput;
