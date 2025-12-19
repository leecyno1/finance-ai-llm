'use client';

import { useEffect, useState } from 'react';
import EmptyChatMessageInput from './EmptyChatMessageInput';
import { File } from './ChatWindow';
import WeatherWidget from './WeatherWidget';
import NewsArticleWidget from './NewsArticleWidget';
import DrLemonBrand from './DrLemonBrand';
import RecommendedQuestions from './RecommendedQuestions';
import {
  getShowNewsWidget,
  getShowWeatherWidget,
  getLanguage,
} from '@/lib/config/clientRegistry';

const EmptyChat = () => {
  const [showWeather, setShowWeather] = useState(() =>
    typeof window !== 'undefined' ? getShowWeatherWidget() : true,
  );
  const [showNews, setShowNews] = useState(() =>
    typeof window !== 'undefined' ? getShowNewsWidget() : true,
  );
  const [language, setLanguage] = useState<'en' | 'zh'>(() =>
    typeof window !== 'undefined'
      ? ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh')
      : 'zh',
  );

  useEffect(() => {
    const updateWidgetVisibility = () => {
      setShowWeather(getShowWeatherWidget());
      setShowNews(getShowNewsWidget());
      setLanguage(
        ((getLanguage() as 'en' | 'zh' | undefined) ?? 'zh') as 'en' | 'zh',
      );
    };

    updateWidgetVisibility();

    window.addEventListener('client-config-changed', updateWidgetVisibility);
    window.addEventListener('storage', updateWidgetVisibility);

    return () => {
      window.removeEventListener(
        'client-config-changed',
        updateWidgetVisibility,
      );
      window.removeEventListener('storage', updateWidgetVisibility);
    };
  }, []);

  return (
    <div className="relative">
      <div className="flex flex-col items-center justify-center min-h-screen max-w-screen-sm mx-auto p-2 space-y-4">
        <div className="flex flex-col items-center justify-center w-full space-y-6">
          {/* 移动端顶部已有品牌栏，这里避免重复占用首屏高度 */}
          <DrLemonBrand className="hidden sm:flex -mt-4" />
          <h2 className="text-black/70 dark:text-white/70 text-2xl sm:text-3xl font-medium -mt-2 sm:-mt-8">
            {language === 'zh'
              ? 'AI金融研究，从这里开始。'
              : 'AI finance research starts here.'}
          </h2>
          {(showWeather || showNews) && (
            <div className="flex flex-col w-full gap-4 mt-1 sm:flex-row sm:justify-center">
              {showWeather && (
                <div className="flex-1 w-full">
                  <WeatherWidget />
                </div>
              )}
              {showNews && (
                <div className="flex-1 w-full">
                  <NewsArticleWidget />
                </div>
              )}
            </div>
          )}
          {/* 对话框输入区域 */}
          <EmptyChatMessageInput />
          {/* 推荐提问模块：基于最新财经快讯生成若干可点击的问题（精简为 5-6 条） */}
          <RecommendedQuestions />
        </div>
        {/* 底部预留空间，避免与移动端底栏重叠 */}
        {(showWeather || showNews) && (
          <div className="h-2" aria-hidden="true">
            {/* spacer */}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmptyChat;
