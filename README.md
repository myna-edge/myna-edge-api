# myna-edge-api

Myna 错误采集 API（Cloudflare Worker + D1），本地开发使用 SQLite。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/myna-edge/myna-edge-api)

一键部署会自动准备 D1（`DB` → `myna-edge`），并预填可选 Secret 名；**不需要鉴权时 token 留空即可**，最小部署可不配任何变量。

## 开发

```powershell
npm install
npm run dev
```

API 默认 `http://127.0.0.1:8787`，数据写入 `./data/myna.db`。

可选：复制 `.env.example` 为 `.env`，或复制 `.dev.vars.example` 为 `.dev.vars`。

## 部署（推荐）

1. 优先使用上方 **Deploy to Cloudflare**（会预填变量名、自动建 D1）
2. 或用 Dashboard **Connect GitHub**（需自行加 Secrets；详见文档）
3. 再部署 [myna-edge-web](https://github.com/myna-edge/myna-edge-web)，把本 Worker URL 填进 `VITE_API_BASE`

**不必**把 `database_id` 或 token 写进仓库。详见 [docs/deploy.md](./docs/deploy.md)。

## 结构

- `src/` — Hono API（Worker 入口 `worker.ts`，本地 Node 入口 `node.ts`）
- `packages/storage/` — 存储层（SQLite / D1 / Turso）
