# myna-edge-api

Myna 错误采集 API（Cloudflare Worker + D1），本地开发使用 SQLite。

## 开发

```powershell
npm install
npm run dev
```

API 默认 `http://127.0.0.1:8787`，数据写入 `./data/myna.db`。

可选：复制 `.env.example` 为 `.env` 并设置 `MYNA_INGEST_TOKEN` 等变量。

## 部署

1. 在 Cloudflare Dashboard 创建 D1 数据库 `myna`，将 Database ID 填入 `wrangler.toml`
2. `npx wrangler login`
3. `npm run deploy`

详见 [docs/deploy.md](./docs/deploy.md)。

## 结构

- `src/` — Hono API（Worker 入口 `worker.ts`，本地 Node 入口 `node.ts`）
- `packages/storage/` — 存储层（SQLite / D1 / Turso）
