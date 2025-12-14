import ChatWindow from '@/components/ChatWindow';
import EconomyTicker from '@/components/EconomyTicker';
import NewsTicker from '@/components/NewsTicker';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chat - Perplexica',
  description: 'Chat with the internet, chat with Perplexica.',
};

const Home = () => {
  return (
    <div className="py-4">
      <div className="flex flex-col lg:flex-row gap-[10px] min-h-[calc(100vh-4rem)]">
        {/* 左侧经济数据条：在首页给更多宽度，中间对话适当收窄 */}
        <div className="w-full lg:w-[360px] xl:w-[420px] lg:flex-shrink-0 lg:flex">
          <EconomyTicker />
        </div>
        {/* 中间聊天区域：在首页略收窄，为两侧滚屏腾出空间 */}
        <div className="w-full lg:flex-1 min-w-0">
          <ChatWindow />
        </div>
        {/* 右侧新闻条：与左侧相同宽度 */}
        <div className="w-full lg:w-[360px] xl:w-[420px] lg:flex-shrink-0 lg:flex">
          <NewsTicker />
        </div>
      </div>
    </div>
  );
};

export default Home;
