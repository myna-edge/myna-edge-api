# myna-edge-api

Myna 错误采集 API（Cloudflare Worker + D1），本地开发使用 SQLite。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/myna-edge/myna-edge-api)

一键部署会按配置预填 D1 绑定名 `DB`，以及 Secret 名 `MYNA_INGEST_TOKEN` / `MYNA_ADMIN_TOKEN`（你只需填值）。

## 开发

```powershell
npm install
npm run dev
```

API 默认 `http://127.0.0.1:8787`，数据写入 `./data/myna.db`。

可选：复制 `.env.example` 为 `.env`，或复制 `.dev.vars.example` 为 `.dev.vars`。

## 部署（推荐）

优先使用上方 **Deploy to Cloudflare** 按钮；也可在 Dashboard 连接本仓库的 GitHub。  
**不必**把 `database_id` 或 token 写进仓库。详见 [docs/deploy.md](./docs/deploy.md)。

## 结构

- `src/` — Hono API（Worker 入口 `worker.ts`，本地 Node 入口 `node.ts`）
- `packages/storage/` — 存储层（SQLite / D1 / Turso）
