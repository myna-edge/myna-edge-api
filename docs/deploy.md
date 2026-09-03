# 部署 API 到 Cloudflare

推荐方式：**Deploy to Cloudflare**（创建页会预填绑定/变量名）。  
`database_id` 和 token **不必**写进仓库。

## 最小可跑 vs 可选鉴权

| 配置 | 是否必须 |
|------|----------|
| D1（库名 `myna-edge`，绑定 `DB`） | 必须，但通常**自动创建/绑定** |
| `MYNA_STORAGE=d1` | 已在 `wrangler.toml`，无需再填 |
| `MYNA_SECRET` | **可选**。同时保护采集与 Webhook 写入；Web 用 `VITE_MYNA_SECRET` / 设置页密钥 |

最小部署：**可以一个 Variables / Secrets 都不手动加**。

## 1. 一键部署（推荐）

打开：

https://deploy.workers.cloudflare.com/?url=https://github.com/myna-edge/myna-edge-api

或点击仓库 README 中的 **Deploy to Cloudflare** 按钮。

创建时 Cloudflare 会：

- 按 `wrangler.toml` **自动准备 D1**（绑定名 `DB`，库名 `myna-edge`），一般不必先去 Dashboard 建库
- **不会**强制填写 token（`.dev.vars.example` 里已注释可选 Secret，避免 Deploy 页当成必填）

需要鉴权时，部署完成后到 Worker **Variables and Secrets** 自行添加：

| 变量 | 说明 |
|------|------|
| `MYNA_SECRET` | 可选。采集 + Webhook 共用密钥 |

部署完成后用 Worker URL 探活（见下方）。

## 2. 手动：Connect GitHub（Workers Builds）

与 Deploy 按钮不同：

- **不会**根据 `.dev.vars.example` 预填变量名
- D1 仍可能随 `wrangler.toml` 自动创建；若 Bindings 里没有，再手动加 `DB` → `myna-edge`
- 若出现 API Token 缺少 `ai_search_write` / `email_routing_*` 等 **Note**：本项目用不到这些能力，一般可忽略

步骤：

1. **Workers & Pages** → **Create** → **Import a repository** → 选择 `myna-edge-api`
2. **Deploy command**：`npx wrangler deploy`（或 `npm run deploy`）
3. 确认 **Settings → Bindings**：D1 `DB` → `myna-edge`
4. 若需要鉴权：在 **Variables and Secrets** 自行添加上表变量（名称需一致）

之后每次 push `main` 会自动重新部署。

### 改完变量要不要 Rebuild？

- **运行时 Secrets / Variables**（如 `MYNA_SECRET`）：在页面保存后 **Save and Deploy** 即可，通常**不必**重新 Build
- **Bindings**（如后来才加的 D1）：需要重新部署一次（触发 Build 或 `wrangler deploy`）

## 3. 探活

```powershell
curl.exe -s https://myna-edge-api.<子域>.workers.dev/api/health
```

期望响应里包含 `storage: "d1"`。

把该 Worker URL 交给 Web（Pages 的 `VITE_API_BASE`）。

## 推荐顺序（端到端）

1. 部署本仓库（API）
2. 部署 [myna-edge-web](https://github.com/myna-edge/myna-edge-web)（Pages，填 `VITE_API_BASE`）
3. 用 [myna-edge-sdk](https://github.com/myna-edge/myna-edge-sdk) 或接入页说明上报到 API 根地址（SDK 自动请求 `/api/ingest`）

## 可选：本地 CLI 部署

本地部署不是必需步骤：

```powershell
npx wrangler login
npm run deploy
```

勿把 token 写进 `wrangler.toml`。
