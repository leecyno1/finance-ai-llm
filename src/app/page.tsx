import ChatWindow from '@/components/ChatWindow';
import EconomyTicker from '@/components/EconomyTicker';
import NewsTicker from '@/components/NewsTicker';
import EconomyTickerCompact from '@/components/EconomyTickerCompact';
import NewsTickerCompact from '@/components/NewsTickerCompact';
import DrLemonBrand from '@/components/DrLemonBrand';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat - Perplexica',
  description: 'Chat with the internet, chat with Perplexica.',
};

const Home = () => {
  return (
    <div className="py-4">
      {/* 仅超窄屏（手机）显示顶部品牌栏，避免占用桌面端布局 */}
      <div className="sm:hidden px-1 mb-3">
        <DrLemonBrand />
      </div>

      <div className="flex flex-col lg:flex-row gap-[10px] min-h-[calc(100vh-4rem)]">
        {/* 左侧经济数据条：在首页给更多宽度，中间对话适当收窄 */}
        <div className="hidden sm:flex w-full lg:w-[360px] xl:w-[420px] lg:flex-shrink-0">
          <EconomyTicker />
        </div>
        {/* 中间聊天区域：在首页略收窄，为两侧滚屏腾出空间 */}
        <div className="w-full lg:flex-1 min-w-0 order-1">
          <ChatWindow />
        </div>
        {/* 右侧新闻条：与左侧相同宽度 */}
        <div className="hidden sm:flex w-full lg:w-[360px] xl:w-[420px] lg:flex-shrink-0">
          <NewsTicker />
        </div>

        {/* 移动端：只展示 3~5 条快照，避免顶端滚屏挤占输入框视野 */}
        <div className="sm:hidden order-2 grid grid-cols-1 gap-[10px]">
          <EconomyTickerCompact marketLimit={3} macroLimit={2} />
          <NewsTickerCompact limit={3} />
        </div>
      </div>
    </div>
  );
};

export default Home;
