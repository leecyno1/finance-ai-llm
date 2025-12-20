# ClawCloud Run 部署指南（金融AI大模型 / Finance AI LLM）

本文档覆盖从“创建 GitHub 仓库 → 推送代码 → 在 ClawCloud Run 部署 → 获取域名与排错”的完整流程。

---

## 1. 创建新的 GitHub 仓库

在 GitHub（账号：leecyno1）创建一个新仓库：

- 仓库名：金融AI大模型
- 可见性：按需选择 Public/Private
- 初始化选项：不要勾选 README / .gitignore / License（本项目已包含）

备注：如果你担心中文仓库名在某些工具链里 URL 编码不兼容，可以用 ASCII 仓库名（例如 `finance-ai-llm`），项目显示名仍保留“金融AI大模型”。

---

## 2. 绑定远程并推送代码

在项目根目录执行（本项目已是 git 仓库，下面会把远程地址从原仓库切换到你的新仓库）：

```bash
# 可选：改成 main 分支（更符合 GitHub 默认）
git branch -M main

# 替换远程 origin（如果 origin 已存在）
git remote remove origin || true

# 方式 A：中文仓库名（GitHub 页面会自动做 URL 编码）
git remote add origin https://github.com/leecyno1/金融AI大模型.git

# 方式 B：ASCII 仓库名（推荐稳定）
# git remote add origin https://github.com/leecyno1/finance-ai-llm.git

# 提交并推送
git add -A
git commit -m "chore: initialize Finance AI LLM project" || true
git push -u origin main
```

如果你更希望“全新历史（只有一个初始提交）”，可以让我帮你把当前仓库改为全新 git 历史（会保留工作区文件但重建 git 历史）。

---

## 3. 在 ClawCloud Run 创建服务

ClawCloud Run 通常支持“从 Git 仓库自动构建并部署 Docker 镜像”。推荐参数如下：

- **Source**：选择 GitHub，并授权访问 `leecyno1/金融AI大模型`（或 `leecyno1/finance-ai-llm`）
- **Build**：Dockerfile
  - Dockerfile 路径：`./Dockerfile`
  - Build Context：仓库根目录
- **Port / Container Port**：`3000`
  - 说明：容器内部还会启动 SearXNG（默认 `8080`），但它只用于容器内调用，通常不需要对外开放。
- **Health Check**：如需配置，建议用 `GET /`（Next.js 首页）

---

## 4. 必要环境变量（Environment Variables）

至少建议配置：

- `SEARXNG_API_URL=http://localhost:8080`

按需配置：

- TuShare（经济数据可选）：
  - `TUSHARE_TOKEN=...`
- 模型提供商（至少一个，否则无法正常对话）：
  - OpenAI / OpenAI-Compatible：`OPENAI_API_KEY`（可选 `OPENAI_BASE_URL`）
  - Anthropic：`ANTHROPIC_API_KEY`
  - Groq：`GROQ_API_KEY`
  - Google：`GOOGLE_API_KEY`

完整模板见项目根目录 `.env.example`。

---

## 5. 访问、检查日志与常见排错

### 获取访问域名
部署成功后，ClawCloud Run 会给你一个 Service URL（域名）。直接访问即可。

### 看日志定位问题
优先检查：

- **启动日志**：是否打印了 `Starting SearXNG...`、`Starting Dr.Lemon...`
- **端口监听**：平台是否要求显式设置 `PORT`（如果需要，可在环境变量里设置 `PORT=3000`）
- **SearXNG 健康**：日志里如果出现 health check timeout，通常不影响主服务；但如果检索失败，请确认 `SEARXNG_API_URL` 是否是 `http://localhost:8080`

### 常见错误与处理

- **构建失败（依赖安装慢/超时）**：重试构建；或在平台侧提高构建超时时间。
- **运行后 502/无响应**：确认平台的对外端口配置为 `3000`。
- **无法对话/模型报错**：确认已配置至少一个模型提供商的 API Key（例如 `OPENAI_API_KEY`）。

---

## 6. 推荐的最小部署配置（MVP）

如果你只想“尽快跑起来”：

- `SEARXNG_API_URL=http://localhost:8080`
- `OPENAI_API_KEY=你的Key`

然后重新部署即可。
