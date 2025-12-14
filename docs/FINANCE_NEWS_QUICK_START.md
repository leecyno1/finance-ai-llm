# 财经新闻快速开始指南

## 🚀 快速开始

### 1. 环境配置（可选）

复制环境变量示例文件：

```bash
cp .env.example .env.local
```

默认所有主流数据源已启用，无需额外配置即可使用。

### 2. 安装依赖

```bash
npm install
# 或
pnpm install
# 或
yarn install
```

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 访问财经新闻页面

打开浏览器访问：`http://localhost:3000/economy`

## 📡 API 使用

### 获取财经新闻

```bash
curl http://localhost:3000/api/economy/news
```

响应示例：

```json
{
  "success": true,
  "data": [
    {
      "id": "cailianpress-123456",
      "title": "央行宣布降准0.5个百分点",
      "source": "财联社",
      "sourceUrl": "https://www.cls.cn/telegraph/123456",
      "publishTime": "2025-12-13T10:30:00.000Z",
      "timestamp": 1734089400000,
      "summary": "中国人民银行决定...",
      "importance": "high"
    }
  ],
  "cached": false,
  "updatedAt": 1734089400000,
  "count": 120
}
```

## 🧪 测试数据源

运行测试脚本检查所有数据源的可用性：

```bash
npx tsx scripts/test-news-sources.ts
```

输出示例：

```
📰 Testing All Finance News Sources

✓ 财联社: 20 items (1234ms)
✓ 华尔街见闻: 18 items (1456ms)
✓ 东方财富: 15 items (987ms)
...

📊 Test Report

Summary:
  Total Sources: 7
  Successful: 7
  Failed: 0
  Total News Items: 145
  After Deduplication: 120
  Deduplication Rate: 17.2%

✓ All tests passed! ✨
```

## 🎨 组件使用

### 在 React 组件中使用

```tsx
import FinanceNews from '@/components/FinanceNews';

export default function MyPage() {
  return (
    <div>
      <h1>我的财经资讯</h1>
      <FinanceNews />
    </div>
  );
}
```

### 直接调用 API

```typescript
import { aggregateNews } from '@/lib/economy/news-sources';

async function getLatestNews() {
  const news = await aggregateNews();
  console.log(`获取到 ${news.length} 条新闻`);
  return news;
}
```

## ⚙️ 配置选项

### 禁用特定数据源

在 `.env.local` 中设置：

```bash
# 禁用雪球数据源
NEWS_SOURCE_XUEQIU=false

# 禁用新浪财经
NEWS_SOURCE_SINA=false
```

### 自定义数据缓存目录

```bash
DATA_DIR=/custom/path/to/data
```

## 🔧 常见问题

### Q: 新闻不显示或显示很少？

**解决方案：**

1. 检查网络连接
2. 运行测试脚本查看哪些数据源失败
3. 尝试禁用失败的数据源

```bash
npx tsx scripts/test-news-sources.ts
```

### Q: 如何增加新闻数量？

默认每个数据源获取 20 条新闻。修改 `src/lib/economy/news-sources.ts` 中的 `size` 或 `limit` 参数：

```typescript
// 例如：财联社
const response = await fetch(
  'https://www.cls.cn/api/sw?rn=50', // 改为 50 条
  ...
);
```

### Q: 缓存时间如何调整？

修改 `src/app/api/economy/news/route.ts`：

```typescript
// 默认 5 分钟
const CACHE_TTL = 5 * 60 * 1000;

// 改为 10 分钟
const CACHE_TTL = 10 * 60 * 1000;
```

## 📈 数据源详情

| 数据源 | 更新频率 | 数据质量 | 推荐场景 |
|--------|---------|---------|---------|
| 财联社 | 实时 | ⭐⭐⭐⭐⭐ | 专业投资者 |
| 华尔街见闻 | 实时 | ⭐⭐⭐⭐⭐ | 国际市场 |
| 东方财富 | 实时 | ⭐⭐⭐⭐ | A股投资者 |
| 雪球 | 准实时 | ⭐⭐⭐⭐ | 散户情绪 |
| 第一财经 | 每日 | ⭐⭐⭐ | 政策解读 |
| 新浪财经 | 每日 | ⭐⭐⭐ | 综合资讯 |
| 同花顺 | 实时 | ⭐⭐⭐ | A股资讯 |

## 🔒 注意事项

1. **请求频率**：默认设置了合理的缓存和请求间隔，请勿修改为过于频繁
2. **数据版权**：所有数据版权归原网站所有，仅供个人学习使用
3. **稳定性**：API 可能随时变更，建议定期检查和维护
4. **商业使用**：不建议用于商业用途，如需商业使用请联系原数据提供方

## 📚 更多文档

- [详细技术文档](./docs/FINANCE_NEWS_SOURCES.md)
- [数据源 API 分析](./docs/NEWS_API_ANALYSIS.md)
- [贡献指南](./CONTRIBUTING.md)

## 🤝 贡献

欢迎贡献新的数据源或改进现有代码！

1. Fork 本项目
2. 创建特性分支
3. 提交代码
4. 发起 Pull Request

## 📞 支持

遇到问题？

1. 查看 [常见问题](#常见问题)
2. 运行测试脚本诊断
3. 提交 Issue

---

**祝使用愉快！** 📈💰
