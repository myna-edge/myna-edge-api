# myna-edge-api

Myna 错误采集 API（Cloudflare Worker + D1），本地开发使用 SQLite。

## 开发

```powershell
npm install
npm run dev
```

API 默认 `http://127.0.0.1:8787`，数据写入 `./data/myna.db`。

可选：复制 `.env.example` 为 `.env` 并设置 `MYNA_INGEST_TOKEN` 等变量。

## 部署（推荐）

面向使用者的标准路径：

1. 在 Cloudflare Dashboard 创建 D1 数据库，名称 `myna`
2. 用 GitHub 连接本仓库，通过 Workers Builds 部署
3. 在 Worker **Variables and Secrets** 中配置 `MYNA_INGEST_TOKEN`（等）
4. 确认 Bindings 中有 D1：`DB` → `myna`

**不必**把 `database_id` 或 token 写进仓库。详见 [docs/deploy.md](./docs/deploy.md)。

## 结构

- `src/` — Hono API（Worker 入口 `worker.ts`，本地 Node 入口 `node.ts`）
- `packages/storage/` — 存储层（SQLite / D1 / Turso）
