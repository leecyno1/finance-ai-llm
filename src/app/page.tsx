import ChatWindow from '@/components/ChatWindow';
import EconomyTicker from '@/components/EconomyTicker';
import NewsTicker from '@/components/NewsTicker';
import EconomyTickerCompact from '@/components/EconomyTickerCompact';
import NewsTickerCompact from '@/components/NewsTickerCompact';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '大圣之怒 · AI金融研究',
  description: '大圣之怒 是面向金融投研的 AI 助手：支持联网检索、财经快讯与宏观数据。',
};

const Home = () => {
  return (
    <div className="py-4 bg-[radial-gradient(1200px_360px_at_50%_-60px,rgba(244,63,94,0.12),transparent_60%),radial-gradient(1100px_360px_at_80%_0,rgba(47,54,201,0.1),transparent_62%)]">
      <div className="flex flex-col lg:flex-row gap-[10px] min-h-[calc(100vh-4rem)]">
        {/* 左侧经济数据条：在首页给更多宽度，中间对话适当收窄 */}
        <div className="hidden sm:flex w-full lg:w-[360px] xl:w-[420px] lg:flex-shrink-0 rounded-2xl border border-rose-400/25 dark:border-fuchsia-500/20 bg-gradient-to-b from-rose-500/5 via-transparent to-blue-600/5">
          <EconomyTicker />
        </div>
        {/* 中间聊天区域：在首页略收窄，为两侧滚屏腾出空间 */}
        <div className="w-full lg:flex-1 min-w-0 rounded-2xl border border-light-200/60 dark:border-dark-200/70 bg-light-primary/55 dark:bg-dark-primary/50">
          <ChatWindow />
        </div>
        {/* 右侧新闻条：与左侧相同宽度 */}
        <div className="hidden sm:flex w-full lg:w-[360px] xl:w-[420px] lg:flex-shrink-0 rounded-2xl border border-blue-500/20 dark:border-blue-500/25 bg-gradient-to-b from-blue-600/8 via-transparent to-rose-500/6">
          <NewsTicker />
        </div>

        {/* 移动端：只展示 3~5 条快照，避免顶端滚屏挤占输入框视野 */}
        <div className="sm:hidden grid grid-cols-1 gap-[10px]">
          <EconomyTickerCompact marketLimit={3} macroLimit={2} />
          <NewsTickerCompact limit={3} />
        </div>
      </div>
    </div>
  );
};

export default Home;
