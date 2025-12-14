/**
 * 财经新闻使用示例
 * 
 * 本文件展示了如何在不同场景下使用财经新闻功能
 */

// ============================================
// 示例 1: 在 React 组件中使用
// ============================================

import FinanceNews from '@/components/FinanceNews';

export function Example1_Component() {
  return (
    <div className="container">
      <h1>财经资讯</h1>
      {/* 直接使用组件 */}
      <FinanceNews />
    </div>
  );
}


// ============================================
// 示例 2: 调用 API 获取数据
// ============================================

async function example2_fetchAPI() {
  try {
    const response = await fetch('/api/economy/news');
    const result = await response.json();

    if (result.success) {
      console.log(`获取到 ${result.count} 条新闻`);
      console.log('缓存状态:', result.cached ? '命中' : '新抓取');
      console.log('更新时间:', new Date(result.updatedAt).toLocaleString());

      // 处理新闻数据
      result.data.forEach((news: any) => {
        console.log(`[${news.source}] ${news.title}`);
      });
    }
  } catch (error) {
    console.error('获取新闻失败:', error);
  }
}


// ============================================
// 示例 3: 直接调用聚合函数
// ============================================

import { aggregateNews } from '@/lib/economy/news-sources';

async function example3_directAggregate() {
  try {
    // 不使用缓存，直接抓取最新数据
    const news = await aggregateNews();

    console.log(`聚合了 ${news.length} 条新闻`);

    // 按来源分组
    const bySource = news.reduce((acc: any, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {});

    console.log('各数据源分布:', bySource);

    // 筛选高重要性新闻
    const important = news.filter(n => n.importance === 'high');
    console.log(`重要新闻: ${important.length} 条`);

    return news;
  } catch (error) {
    console.error('聚合失败:', error);
    return [];
  }
}


// ============================================
// 示例 4: 自定义数据处理
// ============================================

import { NEWS_SOURCES } from '@/lib/economy/news-sources';

async function example4_customProcessing() {
  // 只获取特定来源的新闻
  const cailianpress = NEWS_SOURCES.find(s => s.name === '财联社');
  
  if (cailianpress && cailianpress.enabled) {
    const news = await cailianpress.fetchFn();
    console.log(`财联社新闻: ${news.length} 条`);

    // 自定义过滤和排序
    const filtered = news
      .filter(n => n.importance === 'high') // 只要高重要性
      .sort((a, b) => b.timestamp - a.timestamp) // 按时间倒序
      .slice(0, 10); // 取前 10 条

    return filtered;
  }

  return [];
}


// ============================================
// 示例 5: 实时监控（定时刷新）
// ============================================

class NewsMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdate: (news: any[]) => void;

  constructor(callback: (news: any[]) => void) {
    this.onUpdate = callback;
  }

  start(intervalMs: number = 5 * 60 * 1000) {
    console.log('开始监控财经新闻...');
    
    // 立即获取一次
    this.fetch();

    // 定时刷新
    this.intervalId = setInterval(() => {
      this.fetch();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('停止监控');
    }
  }

  private async fetch() {
    try {
      const response = await fetch('/api/economy/news');
      const result = await response.json();

      if (result.success) {
        console.log(`[${new Date().toLocaleTimeString()}] 获取到 ${result.count} 条新闻`);
        this.onUpdate(result.data);
      }
    } catch (error) {
      console.error('获取新闻失败:', error);
    }
  }
}

// 使用示例
function example5_monitoring() {
  const monitor = new NewsMonitor((news) => {
    console.log('新闻已更新:', news.length);
    
    // 检查是否有高重要性新闻
    const important = news.filter(n => n.importance === 'high');
    if (important.length > 0) {
      console.log(`⚠️ 发现 ${important.length} 条重要新闻！`);
      important.forEach(n => {
        console.log(`  - ${n.title}`);
      });
    }
  });

  // 每 5 分钟刷新一次
  monitor.start(5 * 60 * 1000);

  // 返回停止函数
  return () => monitor.stop();
}


// ============================================
// 示例 6: 数据统计分析
// ============================================

async function example6_statistics() {
  const news = await aggregateNews();

  // 统计信息
  const stats = {
    total: news.length,
    bySource: {} as Record<string, number>,
    byImportance: {
      high: 0,
      medium: 0,
      low: 0,
    },
    timeRange: {
      latest: 0,
      oldest: 0,
    },
  };

  news.forEach(item => {
    // 按来源统计
    stats.bySource[item.source] = (stats.bySource[item.source] || 0) + 1;

    // 按重要性统计
    if (item.importance) {
      stats.byImportance[item.importance]++;
    }

    // 时间范围
    if (stats.timeRange.latest === 0 || item.timestamp > stats.timeRange.latest) {
      stats.timeRange.latest = item.timestamp;
    }
    if (stats.timeRange.oldest === 0 || item.timestamp < stats.timeRange.oldest) {
      stats.timeRange.oldest = item.timestamp;
    }
  });

  console.log('新闻统计:');
  console.log('  总数:', stats.total);
  console.log('  来源分布:', stats.bySource);
  console.log('  重要性分布:', stats.byImportance);
  console.log('  时间范围:', {
    from: new Date(stats.timeRange.oldest).toLocaleString(),
    to: new Date(stats.timeRange.latest).toLocaleString(),
  });

  return stats;
}


// ============================================
// 示例 7: 关键词搜索
// ============================================

async function example7_search(keyword: string) {
  const news = await aggregateNews();

  // 在标题和摘要中搜索关键词
  const results = news.filter(item => {
    const titleMatch = item.title.toLowerCase().includes(keyword.toLowerCase());
    const summaryMatch = item.summary?.toLowerCase().includes(keyword.toLowerCase());
    return titleMatch || summaryMatch;
  });

  console.log(`搜索 "${keyword}" 找到 ${results.length} 条结果`);

  results.forEach(item => {
    console.log(`[${item.source}] ${item.title}`);
  });

  return results;
}


// ============================================
// 示例 8: 导出为 JSON
// ============================================

async function example8_exportJSON(filename: string = 'finance-news.json') {
  const news = await aggregateNews();

  const data = {
    exportTime: new Date().toISOString(),
    count: news.length,
    news: news,
  };

  // 在浏览器中
  if (typeof window !== 'undefined') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  // 在 Node.js 中
  else {
    const fs = require('fs');
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`已导出到 ${filename}`);
  }

  return data;
}


// ============================================
// 示例 9: 配置管理
// ============================================

import { 
  NEWS_SOURCE_SETTINGS, 
  getEnabledSources, 
  isSourceEnabled 
} from '@/lib/economy/news-config';

function example9_configuration() {
  // 获取所有已启用的数据源
  const enabledSources = getEnabledSources();
  console.log('已启用的数据源:', enabledSources.map(s => s.displayName));

  // 检查特定数据源是否启用
  const isCailianpressEnabled = isSourceEnabled('cailianpress');
  console.log('财联社是否启用:', isCailianpressEnabled);

  // 查看所有配置
  console.log('所有数据源配置:', NEWS_SOURCE_SETTINGS);
}


// ============================================
// 示例 10: 错误处理
// ============================================

async function example10_errorHandling() {
  try {
    const response = await fetch('/api/economy/news');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || '未知错误');
    }

    return result.data;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('网络错误，请检查连接');
    } else if (error instanceof Error) {
      console.error('错误:', error.message);
    } else {
      console.error('未知错误:', error);
    }

    // 返回空数组作为降级处理
    return [];
  }
}


// ============================================
// 导出所有示例
// ============================================

export {
  Example1_Component,
  example2_fetchAPI,
  example3_directAggregate,
  example4_customProcessing,
  example5_monitoring,
  example6_statistics,
  example7_search,
  example8_exportJSON,
  example9_configuration,
  example10_errorHandling,
};
