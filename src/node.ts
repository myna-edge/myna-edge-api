import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8787);
const app = createApp();

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[myna-edge-api] http://127.0.0.1:${info.port}`);
  console.log(`[myna-edge-api] storage=${process.env.MYNA_STORAGE || "sqlite"}`);
});
