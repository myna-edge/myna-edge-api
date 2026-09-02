# 部署 API 到 Cloudflare

## 1. 创建 D1

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **D1 SQL Database** → **Create**
2. 名称填 `myna`（与 `wrangler.toml` 中 `database_name` 一致）
3. 复制 **Database ID**，填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "myna"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## 2. 部署

```powershell
npx wrangler login
npm run deploy
```

## 3. 环境变量（推荐）

Dashboard → Worker `myna-api` → **Settings** → **Variables and Secrets**：

| 变量 | 说明 |
|------|------|
| `MYNA_INGEST_TOKEN` | 采集鉴权 token（强烈建议） |
| `MYNA_ADMIN_TOKEN` | 保护 Webhook 配置写入（可选） |

探活：

```powershell
curl.exe -s https://myna-api.<子域>.workers.dev/api/health
```

期望：`storage: "d1"`。
