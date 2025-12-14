本目录用于持久化运行时数据（建议挂载卷）。

- `config.json`：运行时配置（包含模型提供商 Key 等敏感信息），请不要提交到 Git。
- `news-cache.json` / `economy-cache.json`：新闻与经济数据缓存（自动生成）。
- `db.sqlite`：本地数据库（自动生成）。

首次运行时，如果 `config.json` 不存在，程序会自动生成一个默认空配置。你也可以从 `config.example.json` 复制一份：

```bash
cp data/config.example.json data/config.json
```

