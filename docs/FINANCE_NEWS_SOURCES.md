# 财经新闻数据源方案

## 概述

本方案实现了**真实财经新闻**的多源聚合系统，替代了原有的 TuShare 示例数据，提供实时的财经快讯服务。

## 架构设计

### 核心特性

1. **多源聚合**：同时从 7+ 个主流财经网站抓取新闻
2. **智能去重**：基于标题相似度的去重算法
3. **优先级排序**：根据新闻重要性和时效性排序
4. **缓存机制**：5 分钟缓存，减少服务器压力
5. **容错处理**：单个数据源失败不影响整体服务
6. **可配置性**：通过环境变量控制各数据源

### 数据源列表

| 数据源 | 优先级 | 特点 | 状态 |
|--------|--------|------|------|
| 财联社 | ⭐⭐⭐⭐⭐ | 专业财经快讯，更新快 | ✅ 已实现 |
| 华尔街见闻 | ⭐⭐⭐⭐⭐ | 国际财经资讯，深度分析 | ✅ 已实现 |
| 东方财富 | ⭐⭐⭐⭐ | A股市场快讯，数据全面 | ✅ 已实现 |
| 雪球 | ⭐⭐⭐⭐ | 用户讨论热度，市场情绪 | ✅ 已实现 |
| 第一财经 | ⭐⭐⭐ | 权威媒体，政策解读 | ✅ 已实现 |
| 新浪财经 | ⭐⭐⭐ | 综合财经新闻 | ✅ 已实现 |
| 同花顺 | ⭐⭐⭐ | A股资讯 | ✅ 已实现 |
| 金融界 | ⭐⭐ | 证券资讯 | 🔧 可选 |
| 凤凰财经 | ⭐⭐ | 财经评论 | 🔧 可选 |

## 技术实现

### 文件结构

```
src/
├── lib/economy/
│   ├── news-sources.ts      # 新闻抓取核心逻辑
│   ├── news-config.ts       # 数据源配置管理
│   └── tushare.ts           # TuShare 接口（保留）
├── app/api/economy/
│   ├── news/route.ts        # 新闻 API 路由
│   └── summary/route.ts     # 市场数据 API
├── components/
│   ├── FinanceNews.tsx      # 财经新闻组件
│   └── EconomyTicker.tsx    # 滚动条组件
└── app/economy/
    └── page.tsx             # 经济数据页面
```

### 数据结构

```typescript
type NewsItem = {
  id: string;              // 唯一标识
  title: string;           // 新闻标题
  source: string;          // 数据源名称
  sourceUrl: string;       // 原文链接
  publishTime: string;     // ISO 8601 时间
  timestamp: number;       // 时间戳
  summary?: string;        // 摘要
  tags?: string[];         // 标签
  importance?: 'high' | 'medium' | 'low';  // 重要性
};
```

### API 端点

#### GET `/api/economy/news`

获取聚合后的财经新闻列表。

**响应示例：**

```json
{
  "success": true,
  "data": [
    {
      "id": "cailianpress-12345",
      "title": "央行宣布降准0.5个百分点",
      "source": "财联社",
      "sourceUrl": "https://www.cls.cn/telegraph/12345",
      "publishTime": "2025-12-13T10:30:00.000Z",
      "timestamp": 1734089400000,
      "summary": "中国人民银行决定于2025年12月15日下调...",
      "importance": "high"
    }
  ],
  "cached": false,
  "updatedAt": 1734089400000,
  "count": 120
}
```

## 核心算法

### 1. 去重算法

使用 **Levenshtein 距离算法** 判断标题相似度：

```typescript
// 相似度判断阈值：20%
const isSimilar = (str1: string, str2: string): boolean => {
  const minLen = Math.min(str1.length, str2.length);
  const threshold = Math.floor(minLen * 0.2);
  const distance = levenshteinDistance(str1, str2);
  return distance < threshold;
};
```

**规则：**
- 完全相同的标题直接去重
- 子串包含且长度差异 < 5 字符则去重
- 编辑距离 < 20% 则认为相似

### 2. 优先级策略

去重时保留：
1. 重要性更高的新闻（`importance: 'high'`）
2. 发布时间更新的新闻
3. 优先级更高的数据源

### 3. 缓存策略

- **缓存时长**：5 分钟
- **存储位置**：`data/news-cache.json`
- **更新策略**：过期后首次请求触发更新

## 环境变量配置

在 `.env` 或 `.env.local` 中配置：

```bash
# 启用/禁用特定数据源（默认全部启用）
NEWS_SOURCE_CAILIANPRESS=true
NEWS_SOURCE_WALLSTREETCN=true
NEWS_SOURCE_EASTMONEY=true
NEWS_SOURCE_XUEQIU=true
NEWS_SOURCE_YICAI=true
NEWS_SOURCE_SINA=true
NEWS_SOURCE_THS=true
NEWS_SOURCE_JRJ=false
NEWS_SOURCE_PHOENIX=false

# 数据缓存目录（可选）
DATA_DIR=/path/to/data
```

## 使用方法

### 在页面中集成

```tsx
import FinanceNews from '@/components/FinanceNews';

export default function Page() {
  return (
    <div>
      <FinanceNews />
    </div>
  );
}
```

### 直接调用 API

```typescript
// 获取最新财经新闻
const response = await fetch('/api/economy/news');
const { data } = await response.json();

// data 是 NewsItem[] 数组
data.forEach(news => {
  console.log(news.title, news.source);
});
```

### 编程式调用

```typescript
import { aggregateNews } from '@/lib/economy/news-sources';

// 直接聚合新闻（不使用缓存）
const news = await aggregateNews();
```

## 性能优化

### 1. 并发请求

使用 `Promise.allSettled` 并发抓取所有数据源：

```typescript
const results = await Promise.allSettled(
  enabledSources.map(source => source.fetchFn())
);
```

### 2. 容错机制

单个数据源失败不影响其他源：

```typescript
results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    allNews.push(...result.value);
  } else {
    console.error(`Source ${index} failed:`, result.reason);
  }
});
```

### 3. 超时控制

每个数据源设置 5 秒超时：

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

fetch(url, { signal: controller.signal });
```

## 监控与日志

### 抓取成功率

```
✓ 财联社: 20 items
✓ 华尔街见闻: 18 items
✓ 东方财富: 15 items
✗ 雪球 failed: Network timeout
```

### 缓存命中

```
✓ Using cached news data (updated 2 minutes ago)
⟳ Fetching fresh news from all sources...
```

## 常见问题

### Q: 为什么某些新闻源无法获取数据？

A: 可能的原因：
1. 网站 API 变更或需要认证
2. 网络问题或防火墙限制
3. 请求频率过高被限流

**解决方案**：
- 检查网络连接
- 调整 `.env` 禁用失败的数据源
- 增加请求间隔时间

### Q: 如何添加新的数据源？

A: 步骤：
1. 在 `news-sources.ts` 中实现 `fetchXxxNews()` 函数
2. 在 `NEWS_SOURCES` 数组中注册
3. 在 `news-config.ts` 中添加配置
4. 更新本文档

### Q: 去重不够准确怎么办？

A: 可以调整以下参数：
- 编辑距离阈值（默认 20%）
- 子串长度差异阈值（默认 5）
- 比较字符串长度（默认前 30 字符）

## 未来扩展

### 计划支持的功能

- [ ] 新闻分类（宏观、行业、公司）
- [ ] 关键词提取和标签自动化
- [ ] 情感分析（正面/负面/中性）
- [ ] 个性化推荐
- [ ] WebSocket 实时推送
- [ ] 历史新闻检索
- [ ] 导出功能（PDF/Excel）

### 计划接入的数据源

- [ ] 金融界（JRJ）
- [ ] 凤凰财经（Phoenix）
- [ ] 云财经（Cloud Finance）
- [ ] 证券时报（Securities Times）
- [ ] 经济观察网（EEO）

## 许可与免责声明

本方案仅用于学习和研究目的。使用时请遵守各数据源的 robots.txt 和服务条款。

**注意事项：**
1. 请合理控制请求频率，避免给目标网站造成压力
2. 数据版权归原网站所有
3. 不建议用于商业用途
4. API 可能随时变更，需要持续维护

## 贡献

欢迎提交 PR 改进本方案：
- 添加新的数据源
- 优化去重算法
- 改进错误处理
- 完善文档

## 更新日志

### v1.0.0 (2025-12-13)
- ✅ 实现 7 个主流财经网站的新闻抓取
- ✅ 智能去重算法
- ✅ 缓存机制
- ✅ 可配置的数据源管理
- ✅ React 组件和 API 路由
