'use client';

import { cn } from '@/lib/utils';
import {
  BookOpenText,
  Home,
  Search,
  Plus,
  Newspaper,
  Table2,
  BriefcaseBusiness,
} from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import React, { useEffect, useState, type ReactNode } from 'react';
import Layout from './Layout';
import ThemeSwitcher from './theme/Switcher';
import LanguageSwitcher from './LanguageSwitcher';
import { getLanguage } from '@/lib/config/clientRegistry';
import SettingsButton from './Settings/SettingsButton';

const VerticalIconContainer = ({ children }: { children: ReactNode }) => {
  return <div className="flex flex-col items-center w-full">{children}</div>;
};

const Sidebar = ({ children }: { children: React.ReactNode }) => {
  const segments = useSelectedLayoutSegments();
  const [showSettings, setShowSettings] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('showSettings') === 'true'
      : false,
  );

  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );

  useEffect(() => {
    const updateLanguage = () => {
      setLanguage(
        ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh') as 'en' | 'zh',
      );
    };

    const updateSettingsVisible = () => {
      if (typeof window === 'undefined') return;
      setShowSettings(localStorage.getItem('showSettings') === 'true');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('client-config-changed', updateLanguage);
      window.addEventListener('storage', updateLanguage);
      window.addEventListener('settings-button-revealed', updateSettingsVisible);
      window.addEventListener('storage', updateSettingsVisible);

      updateSettingsVisible();
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('client-config-changed', updateLanguage);
        window.removeEventListener('storage', updateLanguage);
        window.removeEventListener(
          'settings-button-revealed',
          updateSettingsVisible,
        );
        window.removeEventListener('storage', updateSettingsVisible);
      }
    };
  }, []);

  const t = (en: string, zh: string) => (language === 'zh' ? zh : en);

  const navLinks = [
    {
      icon: Home,
      href: '/',
      active: segments.length === 0 || segments.includes('c'),
      label: t('Home', '主页'),
    },
    {
      icon: Search,
      href: '/discover',
      active: segments.includes('discover'),
      label: t('Discover', '发现'),
    },
    {
      icon: Search,
      href: '/economy',
      active: segments.includes('economy'),
      label: t('Economy', '经济'),
    },
    {
      icon: Table2,
      href: '/event-impact',
      active: segments.includes('event-impact'),
      label: t('Impact', '矩阵'),
    },
    {
      icon: BriefcaseBusiness,
      href: '/portfolio-check',
      active: segments.includes('portfolio-check'),
      label: t('Portfolio', '体检'),
    },
    {
      icon: Newspaper,
      href: '/newsnow',
      active: segments.includes('newsnow'),
      label: t('NewsNow', '快讯'),
    },
    {
      icon: BookOpenText,
      href: '/library',
      active: segments.includes('library'),
      label: t('Library', '历史'),
    },
  ];

  return (
    <div>
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-[72px] lg:flex-col border-r border-light-200 dark:border-dark-200">
        <div className="flex grow flex-col items-center justify-between gap-y-5 overflow-y-auto bg-light-secondary dark:bg-dark-secondary px-2 py-8 shadow-sm shadow-light-200/10 dark:shadow-black/25">
          <a
            className="p-2.5 rounded-full bg-light-200 text-black/70 dark:bg-dark-200 dark:text-white/70 hover:opacity-70 hover:scale-105 transition duration-200"
            href="/"
          >
            <Plus size={19} className="cursor-pointer" />
          </a>
          <VerticalIconContainer>
            {navLinks.map((link, i) => (
              <Link
                key={i}
                href={link.href}
                className={cn(
                  'relative flex flex-col items-center justify-center space-y-0.5 cursor-pointer w-full py-2 rounded-lg',
                  link.active
                    ? 'text-black/70 dark:text-white/70 '
                    : 'text-black/60 dark:text-white/60',
                )}
              >
                <div
                  className={cn(
                    link.active && 'bg-light-200 dark:bg-dark-200',
                    'group rounded-lg hover:bg-light-200 hover:dark:bg-dark-200 transition duration-200',
                  )}
                >
                  <link.icon
                    size={25}
                    className={cn(
                      !link.active && 'group-hover:scale-105',
                      'transition duration:200 m-1.5',
                    )}
                  />
                </div>
                <p
                  className={cn(
                    link.active
                      ? 'text-black/80 dark:text-white/80'
                      : 'text-black/60 dark:text-white/60',
                    'text-[10px]',
                  )}
                >
                  {link.label}
                </p>
              </Link>
            ))}
          </VerticalIconContainer>

          <div className="flex flex-col items-center gap-2 w-full">
            <ThemeSwitcher className="w-full text-[10px]" />
            <LanguageSwitcher />
            {showSettings && <SettingsButton />}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 w-full z-50 bg-light-secondary dark:bg-dark-secondary px-2 py-2 shadow-sm lg:hidden overflow-x-auto">
        <div className="flex flex-row items-center gap-x-1 min-w-max">
          {navLinks.map((link, i) => (
            <Link
              href={link.href}
              key={i}
              className={cn(
                'relative flex flex-col items-center justify-center text-center min-w-[58px] px-1 py-1 rounded-lg',
                link.active
                  ? 'text-black dark:text-white bg-light-200/70 dark:bg-dark-200/70'
                  : 'text-black dark:text-white/70',
              )}
            >
              <link.icon size={16} />
              <p className="text-[10px] mt-0.5">{link.label}</p>
            </Link>
          ))}
        </div>
      </div>

      <Layout>{children}</Layout>
    </div>
  );
};

export default Sidebar;
