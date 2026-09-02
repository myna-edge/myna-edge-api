# 部署 API 到 Cloudflare

推荐方式：**Deploy to Cloudflare**（创建页会预填绑定/变量名）。  
`database_id` 和 token **不必**写进仓库；token 只在 Cloudflare 页面填值。

## 1. 一键部署（推荐）

打开：

https://deploy.workers.cloudflare.com/?url=https://github.com/myna-edge/myna-edge-api

或点击仓库 README 中的 **Deploy to Cloudflare** 按钮。

创建时 Cloudflare 会：

- 按 `wrangler.toml` 准备 D1（绑定名 `DB`，库名 `myna-edge`）
- 按 `.dev.vars.example` 预填 Secret 名称，你只需填写：

| 变量 | 说明 |
|------|------|
| `MYNA_INGEST_TOKEN` | 采集鉴权 token（强烈建议） |
| `MYNA_ADMIN_TOKEN` | 保护 Webhook 配置写入（可选） |

部署完成后用 Worker URL 探活（见下方）。

## 2. 手动：GitHub 连接 Workers Builds

若不使用 Deploy 按钮：

1. （可选先做）Dashboard → **D1** → 创建数据库，名称 `myna-edge`
2. **Workers & Pages** → **Create** → **Import a repository** → 选择 `myna-edge-api`
3. **Deploy command**：`npx wrangler deploy`（或 `npm run deploy`）
4. 确认 **Settings → Bindings** 有 D1：`DB` → `myna-edge`（缺失则手动添加）
5. **Settings → Variables and Secrets** 添加上表中的 token（名称需一致）

之后每次 push `main` 会自动重新部署。

## 3. 探活

```powershell
curl.exe -s https://myna-edge-api.<子域>.workers.dev/api/health
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
