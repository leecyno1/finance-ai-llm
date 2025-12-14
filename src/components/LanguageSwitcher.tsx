'use client';

import { useEffect, useState } from 'react';
import Select from './ui/Select';

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

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as Lang;
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
    <Select
      className="w-full text-[10px]"
      value={lang}
      onChange={handleChange}
      options={[
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
      ]}
    />
  );
};

export default LanguageSwitcher;

