# 金融AI大模型（Finance AI LLM）

金融AI大模型是一个面向金融研究与资讯检索的开源 Web 应用：把“实时财经快讯 + 经济数据 + 可配置大模型智能问答”组合在一个界面里，适用于投研快速扫盘、宏观跟踪、热点事件溯源与问答式检索。

Finance AI LLM is an open-source web app for financial research and information retrieval, combining “real-time finance news + macro/market data + configurable LLM Q&A” in one place.

本项目默认输出中文；当 UI 语言切换为英文时自动改用英文回复。
The default response language is Chinese; it switches to English when the UI language is English.

## 核心能力（Key Features）
- **财经快讯聚合**：多源抓取 + 智能去重 + 优先级排序，支持滚动播报与左右栏展示。
- **经济数据看板**：TuShare 指数/宏观数据（可选），支持缓存与增量更新。
- **智能问答**：基于 LangChain，支持多家模型提供商（OpenAI 兼容 / Anthropic / Groq / Google / Ollama 等）。
- **检索增强**：内置 SearXNG（容器内默认 8080），也可指向自建 SearXNG。
- **简洁交互**：推荐提问（历史高频 + 最新快讯），一键发问。
- **配置保护**：输入暗号 `8899174` 可显示/隐藏设置按钮，适合公开演示。
- **Docker 化部署**：提供包含 SearXNG 的镜像构建，并支持 data/uploads 持久化。
- **天气卡片**：默认北京；未授权定位时按访问者 IP 粗定位（可关闭定位权限也能用）。

## P0 可观测性与契约（P0 Observability Contract）
- `GET /api/news/finance`：统一返回 `ok / cached / slot / count / items / sourceStats`，并附带 `sourceHealth / totalFetched / dedupedCount`。
- `GET /api/economy/news`：统一返回 `ok / cached / slot / count / items / sourceStats`，保留兼容字段 `success / data`，并附带 `sourceHealth`。
- `GET /api/economy/news/health`：返回新闻源运行健康快照（熔断是否开启、连续失败次数、最近错误和时间）。
- `GET /api/cache/observability`：返回缓存模块命中率、slot 粒度请求统计、重算耗时统计（`news_finance / economy_news / discover / event_impact`）。
  - 包含 `slowRecomputeTop`（跨模块慢重算 Top 列表，按 `recomputeAvgMs` 降序）。
  - 包含 `trendSeries`（按 slot 时间序列，含 `hitRate/recomputeAvgMs/recomputeMaxMs/requests/misses`）。
  - 包含 `thresholds`（告警阈值），支持通过环境变量配置：`CACHE_HIT_RATE_WARN_PCT`、`CACHE_RECOMPUTE_AVG_WARN_MS`、`CACHE_RECOMPUTE_MAX_WARN_MS`。
  - 支持筛选参数：`module=all|news_finance|economy_news|discover|event_impact`、`windowHours=<N>`、`topN=<N>`。
- `POST /api/cache/invalidate`：支持按 `scope` 手动失效并可选 `rewarm` 预热（`scope=all|news_finance|economy_news|discover|event_impact`）。
- `sourceStats` 语义：
  - `status=ok`：本轮成功抓取；
  - `status=failed`：本轮抓取失败（`errorType` 可为 `timeout/network/http/parse/content_type/unknown`）；
  - `status=skipped`：触发熔断窗口（`errorType=circuit_open`），暂时跳过。
- 缓存工作器 `scripts/cache-worker.js` 日志包含错误分类：`network_timeout / dns / network / non_2xx / parse / unknown`，用于快速定位故障类型。
- 当配置 `ADMIN_ACCESS_TOKEN` 时，管理类 POST 接口（如 `/api/config`、`/api/cache/invalidate`）将强制鉴权，需携带 `x-admin-token` 或 `Authorization: Bearer <token>`。

## P2 提示词治理与可追溯（P2 Prompt Governance）
- 事件驱动接口 `GET /api/finance/event-impact` 返回 `promptMeta`，用于标识资产配置观点与基金推荐提示词来源（`env|config|default`）。
- 基金诊断接口 `POST /api/finance/portfolio-check` 在 `agentMeta` 中返回 `promptTemplateSource` 与 `systemPromptSource`，便于追踪 Agent 输出所用模板来源。

## 适用场景（Use Cases）
- **盘前/盘中速览**：快速获取市场要闻与宏观变化。
- **热点追踪与溯源**：对同一事件多源对比，减少信息偏差。
- **投研辅助问答**：结合检索结果进行摘要、对比、要点提炼（需自行配置模型 Key）。

## 配置与安全（Config & Security）
- **不要把 API Key 写进仓库**：运行时配置位于 `data/config.json`（默认被忽略），请通过环境变量或挂载卷注入。
- 示例：`data/config.example.json`（可复制为 `data/config.json`）。

## 快速开始（Local Dev）
```bash
yarn install
yarn dev -p 3000
```

推荐从环境变量模板开始：复制 `.env.example` 为 `.env.local` 并按需填写（例如 TuShare、新闻源开关、模型 API Key、SearXNG URL）。

访问 `http://localhost:3000`。

## 并发与容量（Concurrency & Capacity）
本项目没有“写死的并发人数上限”，实际并发主要由 3 个因素决定：
1) **模型 API 的 QPS/并发限制**（最常见瓶颈）
2) **容器资源**（CPU/内存，尤其是检索与流式输出）
3) **搜索与新闻数据源**（SearXNG/外部源的可用性与限流）

经验值（仅供估算）：单副本 1 vCPU / 2GB 内存，一般可支撑 **5–20 个**轻量并发会话；重检索/长回答会更低。需要更高并发时，优先 **提升资源或多副本扩容**，并关注上游模型的并发与速率限制。

## Docker 构建与运行（Docker）
```bash
docker build -t finance-ai-llm:latest .

docker run -d --name finance-ai-llm \
  -p 3000:3000 \
  -e SEARXNG_API_URL=http://localhost:8080 \
  -e TUSHARE_TOKEN=<your_tushare_token> \
  -v finance-ai-llm-data:/home/perplexica/data \
  -v finance-ai-llm-uploads:/home/perplexica/uploads \
  finance-ai-llm:latest
```

如果本地网络无法访问 Docker Hub，可用镜像代理替换基础镜像（示例）：
```bash
docker build -t finance-ai-llm:latest --build-arg NODE_IMAGE=dockerproxy.com/library/node:24.5.0-slim .
```

说明：镜像内会启动一个 SearXNG（默认 8080），一般无需对外暴露；如需调试可额外映射 `-p 8080:8080`。

## 持久化目录（Persistence）
- `/home/perplexica/data`：配置与缓存（新闻/经济数据等）
- `/home/perplexica/uploads`：上传文件

## ClawCloud Run 部署
见 `DEPLOYMENT.md`（包含：连接仓库、部署参数、端口/环境变量、访问与日志排查）。

## 技术栈（Tech Stack）
- Next.js（App Router）, React, TailwindCSS
- LangChain（多模型提供商适配）
- SearXNG（搜索 / RAG 检索）
- Docker

## 开源许可与致谢（License & Attribution）
本项目遵循 MIT License，并保留原始版权声明与许可文本，详见 `LICENSE`。

## License
MIT
