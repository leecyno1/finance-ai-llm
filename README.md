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
- **简洁交互**：推荐提问（固定高频 + 最新快讯），一键发问。
- **配置保护**：输入暗号 `8899174` 可显示/隐藏设置按钮，适合公开演示。
- **Docker 化部署**：提供包含 SearXNG 的镜像构建，并支持 data/uploads 持久化。

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

## 致谢（Acknowledgements）
本项目基于 Perplexica 的工程结构进行二次开发与定制。

## License
MIT
