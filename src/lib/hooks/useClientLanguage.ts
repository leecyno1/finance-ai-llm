import { useEffect, useState } from 'react';
import { getLanguage } from '@/lib/config/clientRegistry';

export const useClientLanguage = (initial: 'zh' | 'en' = 'zh') => {
  const [language, setLanguage] = useState<'zh' | 'en'>(initial);

  useEffect(() => {
    const updateLanguage = () => {
      const lang = getLanguage();
      setLanguage(lang === 'en' ? 'en' : 'zh');
    };

    updateLanguage();

    if (typeof window !== 'undefined') {
      window.addEventListener('client-config-changed', updateLanguage);
      window.addEventListener('storage', updateLanguage);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('client-config-changed', updateLanguage);
        window.removeEventListener('storage', updateLanguage);
      }
    };
  }, []);

  return language;
};
