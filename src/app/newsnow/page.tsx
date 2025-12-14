import NewsNowView from '@/components/NewsNowView';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '快讯 - 实时财经快讯',
  description: '聚合多家公开财经新闻源，提供实时滚动快讯视图。',
};

const NewsNowPage = () => {
  return <NewsNowView />;
};

export default NewsNowPage;
