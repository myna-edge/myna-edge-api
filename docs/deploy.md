# 部署 API 到 Cloudflare

推荐方式：**Dashboard 创建 D1** + **GitHub 连接 Workers Builds**。  
`database_id` 和 token **不必**写进仓库；token 只在 Cloudflare 页面配置。

## 1. 创建 D1

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **D1 SQL Database** → **Create**
2. 名称填 `myna`（与 `wrangler.toml` 中 `database_name` 一致）

## 2. 用 GitHub 连接部署

1. Dashboard → **Workers & Pages** → **Create** → 选择 **Import a repository**（连接 GitHub 上的 `myna-edge-api`）
2. 构建设置大致如下：
   - **Deploy command**：`npx wrangler deploy`（或 `npm run deploy`）
   - 一般无需额外 Build command
3. 首次部署成功后，确认 Worker 名称为 `myna-api`（与 `wrangler.toml` 的 `name` 一致）
4. **Settings → Bindings**：应存在 D1 绑定 `DB` → 数据库 `myna`  
   若缺失，手动添加：Type = D1，Variable name = `DB`，选择刚创建的 `myna`

之后每次 push `main` 会自动重新部署。

## 3. 环境变量 / Secrets（在网页上填）

Worker `myna-api` → **Settings** → **Variables and Secrets**：

| 变量 | 说明 |
|------|------|
| `MYNA_INGEST_TOKEN` | 采集鉴权 token（强烈建议） |
| `MYNA_ADMIN_TOKEN` | 保护 Webhook 配置写入（可选） |

不要把这些值提交到 Git。

## 4. 探活

```powershell
curl.exe -s https://myna-api.<子域>.workers.dev/api/health
```

期望响应里包含 `storage: "d1"`。

把该 Worker URL 交给 Web 控制台，作为 `VITE_API_BASE`。

## 可选：本地 CLI 部署

本地部署不是必需步骤。若已安装并登录 Wrangler：

```powershell
npx wrangler login
npm run deploy
```

仍建议在 Dashboard 配置 Secrets；勿把 token 写进 `wrangler.toml`。
