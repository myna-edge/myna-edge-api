/**
 * Cloudflare Workers entry — same routes as local Node.
 * Default storage: D1 (CF-native). sqlite is local-only.
 */
import { createApp } from "./app.js";
import { setD1Binding, type D1Binding } from "@myna-edge/storage";

export type WorkerEnv = {
  DB: D1Binding;
  MYNA_STORAGE?: string;
  MYNA_INGEST_TOKEN?: string;
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

function applyEnv(env: WorkerEnv) {
  const keys = [
    "MYNA_STORAGE",
    "MYNA_INGEST_TOKEN",
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
  ] as const;
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
  if (!process.env.MYNA_STORAGE) {
    process.env.MYNA_STORAGE = "d1";
  }
  if (env.DB) {
    setD1Binding(env.DB);
  }
}

const app = createApp();

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    applyEnv(env);
    return app.fetch(request);
  },
};
