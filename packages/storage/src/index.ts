import type { StorageDriver, StorageKind } from "./types.js";

export type {
  EventRow,
  EventTrendPoint,
  IngestPayload,
  IngestResult,
  Issue,
  IssueFilterOptions,
  IssueListQuery,
  IssueListResult,
  IssueStats,
  IssueStatus,
  StorageDriver,
  StorageKind,
  WebhookAlertKind,
  WebhookConfig,
} from "./types.js";
export {
  DEFAULT_WEBHOOK_CONFIG,
  parseWebhookConfig,
  serializeWebhookConfig,
  validateWebhookConfig,
  WEBHOOK_SETTINGS_KEY,
} from "./types.js";
export type { D1Binding } from "./d1.js";
export { SCHEMA_SQL } from "./schema.js";
export { fingerprintOf, normalizeStack } from "./fingerprint.js";
export {
  enrichIngestPayload,
  extractRequestMeta,
  mergeClientWithRequest,
  resolveClientIp,
} from "./request-meta.js";
export type { RequestMeta } from "./request-meta.js";
export { setD1Binding } from "./d1.js";

function readKind(): StorageKind {
  const raw = (process.env.MYNA_STORAGE || "sqlite").trim().toLowerCase();
  if (raw === "sqlite" || raw === "d1" || raw === "turso") return raw;
  throw new Error(
    `[myna] Unknown MYNA_STORAGE="${raw}". Use one of: sqlite | d1 | turso.\n` +
      `  Local default: sqlite · Cloudflare deploy default: d1`,
  );
}

let cached: StorageDriver | null = null;
let loading: Promise<StorageDriver> | null = null;

/** Resolves the active driver. Uses dynamic import so Workers can tree-shake sqlite. */
export async function getStorage(): Promise<StorageDriver> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const kind = readKind();
    if (kind === "sqlite") {
      const { createSqliteDriver } = await import("./sqlite.js");
      cached = createSqliteDriver();
      return cached;
    }
    if (kind === "turso") {
      const { createTursoDriver } = await import("./turso.js");
      cached = createTursoDriver();
      return cached;
    }
    if (kind === "d1") {
      const { createD1Driver, getD1Binding } = await import("./d1.js");
      const db = getD1Binding();
      if (!db) {
        throw new Error(
          `[myna] Storage "d1" needs the Worker D1 binding (env.DB).\n` +
            `  1) Cloudflare Dashboard 创建 D1，名称 myna-edge\n` +
            `  2) Worker Settings → Bindings：添加 D1，变量名 DB → 选择 myna-edge\n` +
            `  3) 重新部署（GitHub Workers Builds 或 wrangler deploy）`,
        );
      }
      cached = createD1Driver(db);
      return cached;
    }
    throw new Error(`[myna] Unhandled storage kind`);
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}
