import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8787);
const hostname = (process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const app = createApp();

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[myna-edge-api] http://127.0.0.1:${info.port}`);
  if (hostname === "0.0.0.0") {
    console.log(`[myna-edge-api] listening on 0.0.0.0:${info.port} (LAN reachable)`);
  } else {
    console.log(`[myna-edge-api] http://${hostname}:${info.port}`);
  }
  console.log(`[myna-edge-api] storage=${process.env.MYNA_STORAGE || "sqlite"}`);
});
