#!/usr/bin/env node

/**
 * 财经新闻数据源测试脚本
 * 用于测试各个新闻源的可用性和数据质量
 */

import { NEWS_SOURCES, aggregateNews } from '../src/lib/economy/news-sources';

const TEST_COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg: string) => console.log(`${TEST_COLORS.blue}ℹ${TEST_COLORS.reset} ${msg}`),
  success: (msg: string) => console.log(`${TEST_COLORS.green}✓${TEST_COLORS.reset} ${msg}`),
  error: (msg: string) => console.log(`${TEST_COLORS.red}✗${TEST_COLORS.reset} ${msg}`),
  warn: (msg: string) => console.log(`${TEST_COLORS.yellow}⚠${TEST_COLORS.reset} ${msg}`),
  title: (msg: string) => console.log(`\n${TEST_COLORS.bright}${TEST_COLORS.cyan}${msg}${TEST_COLORS.reset}\n`),
};

async function testSingleSource(sourceName: string, fetchFn: () => Promise<any[]>) {
  try {
    log.info(`Testing ${sourceName}...`);
    const startTime = Date.now();
    const news = await fetchFn();
    const duration = Date.now() - startTime;

    if (news && news.length > 0) {
      log.success(`${sourceName}: ${news.length} items (${duration}ms)`);
      
      // 显示第一条新闻的详情
      const first = news[0];
      console.log(`  └─ Latest: ${first.title.substring(0, 60)}...`);
      console.log(`     Source URL: ${first.sourceUrl}`);
      console.log(`     Time: ${new Date(first.timestamp).toLocaleString('zh-CN')}`);
      console.log(`     Importance: ${first.importance || 'N/A'}`);
      
      return { success: true, count: news.length, duration };
    } else {
      log.warn(`${sourceName}: No data returned`);
      return { success: false, count: 0, duration };
    }
  } catch (error: any) {
    log.error(`${sourceName}: ${error.message}`);
    return { success: false, count: 0, duration: 0, error: error.message };
  }
}

async function testAllSources() {
  log.title('📰 Testing All Finance News Sources');

  const results: Record<string, any> = {};

  for (const source of NEWS_SOURCES) {
    if (!source.enabled) {
      log.warn(`${source.name}: Disabled (skip)`);
      continue;
    }

    const result = await testSingleSource(source.name, source.fetchFn);
    results[source.name] = result;

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

async function testAggregation() {
  log.title('🔄 Testing News Aggregation & Deduplication');

  try {
    log.info('Aggregating news from all sources...');
    const startTime = Date.now();
    const aggregated = await aggregateNews();
    const duration = Date.now() - startTime;

    log.success(`Aggregated ${aggregated.length} unique news items (${duration}ms)`);

    // 统计各数据源占比
    const sourceCounts: Record<string, number> = {};
    aggregated.forEach(item => {
      const source = item.source;
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });

    console.log('\n  Source Distribution:');
    Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        const percentage = ((count / aggregated.length) * 100).toFixed(1);
        console.log(`    ${source}: ${count} (${percentage}%)`);
      });

    // 统计重要性分布
    const importanceCounts = {
      high: aggregated.filter(n => n.importance === 'high').length,
      medium: aggregated.filter(n => n.importance === 'medium').length,
      low: aggregated.filter(n => n.importance === 'low').length,
    };

    console.log('\n  Importance Distribution:');
    console.log(`    High: ${importanceCounts.high}`);
    console.log(`    Medium: ${importanceCounts.medium}`);
    console.log(`    Low: ${importanceCounts.low}`);

    // 显示最新的 5 条新闻
    console.log('\n  Latest 5 News:');
    aggregated.slice(0, 5).forEach((item, idx) => {
      console.log(`    ${idx + 1}. [${item.source}] ${item.title.substring(0, 50)}...`);
    });

    return { success: true, count: aggregated.length, duration };
  } catch (error: any) {
    log.error(`Aggregation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function generateReport(sourceResults: Record<string, any>, aggregationResult: any) {
  log.title('📊 Test Report');

  const total = Object.keys(sourceResults).length;
  const successful = Object.values(sourceResults).filter((r: any) => r.success).length;
  const failed = total - successful;
  const totalNews = Object.values(sourceResults).reduce((sum: number, r: any) => sum + r.count, 0);

  console.log('Summary:');
  console.log(`  Total Sources: ${total}`);
  console.log(`  Successful: ${TEST_COLORS.green}${successful}${TEST_COLORS.reset}`);
  console.log(`  Failed: ${failed > 0 ? TEST_COLORS.red : TEST_COLORS.reset}${failed}${TEST_COLORS.reset}`);
  console.log(`  Total News Items: ${totalNews}`);
  console.log(`  After Deduplication: ${aggregationResult.count || 0}`);
  console.log(`  Deduplication Rate: ${totalNews > 0 ? ((1 - (aggregationResult.count || 0) / totalNews) * 100).toFixed(1) : 0}%`);

  if (failed > 0) {
    console.log('\nFailed Sources:');
    Object.entries(sourceResults).forEach(([name, result]: [string, any]) => {
      if (!result.success) {
        console.log(`  ${TEST_COLORS.red}✗${TEST_COLORS.reset} ${name}: ${result.error || 'Unknown error'}`);
      }
    });
  }

  console.log('\n' + '='.repeat(60));
  
  if (successful === total && aggregationResult.success) {
    log.success('All tests passed! ✨');
  } else if (successful > 0) {
    log.warn('Some tests failed, but core functionality works.');
  } else {
    log.error('All tests failed! Please check your network and configurations.');
  }
}

async function main() {
  console.log(`${TEST_COLORS.bright}${TEST_COLORS.cyan}`);
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Finance News Sources Test Suite                     ║');
  console.log('║       Testing Real-time Financial News Aggregation        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(TEST_COLORS.reset);

  const sourceResults = await testAllSources();
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const aggregationResult = await testAggregation();
  
  await generateReport(sourceResults, aggregationResult);

  console.log('\n');
}

// Run tests
main().catch(error => {
  log.error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
