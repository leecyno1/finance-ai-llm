'use client';

import { cn } from '@/lib/utils';
import {
  BookOpenText,
  Compass,
  Home,
  Plus,
  Newspaper,
  Table2,
  BriefcaseBusiness,
  PieChart,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import React, { useEffect, useState, type ReactNode } from 'react';
import Layout from './Layout';
import ThemeSwitcher from './theme/Switcher';
import LanguageSwitcher from './LanguageSwitcher';
import SettingsButton from './Settings/SettingsButton';
import { useClientLanguage } from '@/lib/hooks/useClientLanguage';
import BrandLogo from './BrandLogo';

const VerticalIconContainer = ({ children }: { children: ReactNode }) => {
  return <div className="flex flex-col items-center w-full">{children}</div>;
};

const Sidebar = ({ children }: { children: React.ReactNode }) => {
  const segments = useSelectedLayoutSegments();
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const language = useClientLanguage('zh');

  useEffect(() => {
    const updateSettingsVisible = () => {
      if (typeof window === 'undefined') return;
      setShowSettings(localStorage.getItem('showSettings') === 'true');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('settings-button-revealed', updateSettingsVisible);
      window.addEventListener('storage', updateSettingsVisible);

      updateSettingsVisible();
    }

    return () => {
      if (typeof window !== 'undefined') {
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
      icon: Compass,
      href: '/discover',
      active: segments.includes('discover'),
      label: t('Discover', '发现'),
    },
    {
      icon: TrendingUp,
      href: '/economy',
      active: segments.includes('economy'),
      label: t('Economy', '经济'),
    },
    {
      icon: Table2,
      href: '/event-impact',
      active: segments.includes('event-impact'),
      label: t('Event-driven', '事件驱动'),
    },
    {
      icon: PieChart,
      href: '/asset-allocation',
      active: segments.includes('asset-allocation'),
      label: t('Allocation', '资产配置'),
    },
    {
      icon: BriefcaseBusiness,
      href: '/portfolio-check',
      active: segments.includes('portfolio-check'),
      label: t('Fund Check', '基金诊断'),
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
      <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-[68px] lg:flex-col border-r border-light-200 dark:border-dark-200">
        <div className="flex grow flex-col items-center justify-between gap-y-5 overflow-y-auto bg-light-secondary dark:bg-dark-secondary px-2 py-8 shadow-sm shadow-light-200/10 dark:shadow-black/25">
          <Link href="/" className="mb-0.5">
            <BrandLogo mode="sidebar" />
          </Link>
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

          <div className="flex flex-col items-center gap-1 w-full pb-1">
            <ThemeSwitcher compact />
            <LanguageSwitcher compact />
            {showSettings && (
              <div className="scale-100">
                <SettingsButton compact />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 w-full z-50 bg-light-secondary dark:bg-dark-secondary px-2 py-2 shadow-sm lg:hidden overflow-x-auto">
        <div className="flex items-center justify-between gap-2 mb-2">
          <ThemeSwitcher compact />
          <LanguageSwitcher compact />
          {showSettings && <SettingsButton compact />}
        </div>
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
