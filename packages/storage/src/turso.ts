import { createClient, type Client } from "@libsql/client";
import { fingerprintOf } from "./fingerprint.js";
import { SCHEMA_MIGRATIONS, SCHEMA_SQL, isIgnorableMigrationError } from "./schema.js";
import { parseExtra, serializeExtra } from "./extra.js";
import { parseClient, serializeClient } from "./client.js";
import { fillEventTrend, trendSinceIso } from "./eventTrend.js";
import { ISSUE_LIST_SELECT, normalizeIssueListQuery } from "./issue-list.js";
import {
  mapBreakdownRows,
  mapTopIssueRows,
  OVERVIEW_BREAKDOWN_ENV_SQL,
  OVERVIEW_BREAKDOWN_PAGE_SQL,
  OVERVIEW_BREAKDOWN_RELEASE_SQL,
  OVERVIEW_BREAKDOWN_TYPE_SQL,
  OVERVIEW_NEW_ISSUES_COUNT_SQL,
  OVERVIEW_NEW_ISSUES_TREND_SQL,
  OVERVIEW_TOP_ISSUES_SQL,
  overviewSince,
} from "./overview.js";
import type {
  EventRow,
  EventTrendPoint,
  IngestPayload,
  IngestResult,
  Issue,
  IssueFilterOptions,
  IssueListQuery,
  IssueListResult,
  IssueStats,
  OverviewData,
  StorageDriver,
  WebhookConfig,
} from "./types.js";
import {
  parseWebhookConfig,
  serializeWebhookConfig,
  WEBHOOK_SETTINGS_KEY,
} from "./webhook-config.js";

const globalForTurso = globalThis as unknown as {
  __mynaTurso?: Client;
  __mynaTursoReady?: Promise<void>;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[myna] Missing ${name}.\n` +
        `  Set MYNA_STORAGE=turso plus:\n` +
        `  TURSO_DATABASE_URL=libsql://<db>-<org>.turso.io\n` +
        `  TURSO_AUTH_TOKEN=<token>\n` +
        `  Create DB: https://docs.turso.tech/quickstart`,
    );
  }
  return value;
}

function getClient(): Client {
  if (globalForTurso.__mynaTurso) return globalForTurso.__mynaTurso;

  const url = requireEnv("TURSO_DATABASE_URL");
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!authToken && !url.startsWith("file:")) {
    throw new Error(
      `[myna] TURSO_AUTH_TOKEN is required for remote Turso URLs.\n` +
        `  file: URLs may omit the token for local libSQL.`,
    );
  }

  globalForTurso.__mynaTurso = createClient({
    url,
    authToken: authToken || undefined,
  });
  return globalForTurso.__mynaTurso;
}

async function ensureSchema(client: Client) {
  if (!globalForTurso.__mynaTursoReady) {
    globalForTurso.__mynaTursoReady = (async () => {
      await client.executeMultiple(SCHEMA_SQL);
      for (const sql of SCHEMA_MIGRATIONS) {
        try {
          await client.execute(sql);
        } catch (error) {
          if (!isIgnorableMigrationError(error)) throw error;
        }
      }
    })();
  }
  await globalForTurso.__mynaTursoReady;
}

export function createTursoDriver(): StorageDriver {
  // Fail fast when env is incomplete (don't wait for first query).
  getClient();

  return {
    kind: "turso",

    async ingestEvent(payload: IngestPayload): Promise<IngestResult> {
      const client = getClient();
      await ensureSchema(client);

      const now = payload.timestamp || new Date().toISOString();
      const message = (payload.message || "Unknown error").trim() || "Unknown error";
      const type = (payload.type || "error").trim() || "error";
      const stack = payload.stack ?? null;
      const fingerprint = await fingerprintOf(message, stack);

      const existingRes = await client.execute({
        sql: "SELECT id, status FROM issues WHERE fingerprint = ?",
        args: [fingerprint],
      });
      const existing = existingRes.rows[0] as
        | { id: number | bigint; status: string }
        | undefined;

      if (existing) {
        const issueId = Number(existing.id);
        await client.batch(
          [
            {
              sql: `UPDATE issues
                    SET count = count + 1,
                        last_seen = ?,
                        title = ?,
                        type = ?,
                        release = COALESCE(?, release),
                        environment = COALESCE(?, environment),
                        url = COALESCE(?, url),
                        status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
                    WHERE id = ?`,
              args: [
                now,
                message,
                type,
                payload.release ?? null,
                payload.environment ?? null,
                payload.url ?? null,
                issueId,
              ],
            },
            {
              sql: `INSERT INTO events
                      (issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                issueId,
                message,
                type,
                stack,
                payload.url ?? null,
                payload.userAgent ?? null,
                payload.release ?? null,
                payload.environment ?? null,
                payload.userId ?? null,
                serializeExtra(payload.extra),
                serializeClient(payload.client),
                payload.clientIp ?? null,
                now,
              ],
            },
          ],
          "write",
        );
        return {
          issueId,
          fingerprint,
          alert: existing.status === "resolved" ? "reopened" : undefined,
        };
      }

      const insertIssue = await client.execute({
        sql: `INSERT INTO issues
                (fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url)
              VALUES (?, ?, ?, 1, 'open', ?, ?, ?, ?, ?)`,
        args: [
          fingerprint,
          message,
          type,
          now,
          now,
          payload.release ?? null,
          payload.environment ?? null,
          payload.url ?? null,
        ],
      });
      const issueId = Number(insertIssue.lastInsertRowid);
      await client.execute({
        sql: `INSERT INTO events
                (issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          issueId,
          message,
          type,
          stack,
          payload.url ?? null,
          payload.userAgent ?? null,
          payload.release ?? null,
          payload.environment ?? null,
          payload.userId ?? null,
          serializeExtra(payload.extra),
          serializeClient(payload.client),
          payload.clientIp ?? null,
          now,
        ],
      });
      return { issueId, fingerprint, alert: "new" };
    },

    async listIssues(query: IssueListQuery = {}): Promise<IssueListResult> {
      const client = getClient();
      await ensureSchema(client);
      const { where, args, limit, offset, orderBy } = normalizeIssueListQuery(query);
      const totalRes = await client.execute({
        sql: `SELECT COUNT(*) AS total FROM issues WHERE ${where}`,
        args,
      });
      const res = await client.execute({
        sql: `${ISSUE_LIST_SELECT}
              FROM issues
              WHERE ${where}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?`,
        args: [...args, limit, offset],
      });
      return {
        issues: res.rows.map(rowToIssue),
        total: Number(totalRes.rows[0]?.total ?? 0),
      };
    },

    async listFilterOptions(): Promise<IssueFilterOptions> {
      const client = getClient();
      await ensureSchema(client);
      const envs = await client.execute(
        `SELECT DISTINCT environment AS value FROM issues
         WHERE environment IS NOT NULL AND environment != ''
         ORDER BY environment`,
      );
      const releases = await client.execute(
        `SELECT DISTINCT release AS value FROM issues
         WHERE release IS NOT NULL AND release != ''
         ORDER BY release`,
      );
      return {
        environments: envs.rows.map((r) => String(r.value)),
        releases: releases.rows.map((r) => String(r.value)),
      };
    },

    async getIssueStats(): Promise<IssueStats> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute(
        `SELECT
           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
           SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
           SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
           COALESCE(SUM(CASE WHEN status = 'open' THEN count ELSE 0 END), 0) AS open_events
         FROM issues`,
      );
      const row = res.rows[0] as {
        open_count: number | bigint | null;
        resolved_count: number | bigint | null;
        ignored_count: number | bigint | null;
        open_events: number | bigint | null;
      };
      return {
        openCount: Number(row?.open_count ?? 0),
        resolvedCount: Number(row?.resolved_count ?? 0),
        ignoredCount: Number(row?.ignored_count ?? 0),
        openEvents: Number(row?.open_events ?? 0),
      };
    },

    async getEventTrend(days = 7): Promise<EventTrendPoint[]> {
      const client = getClient();
      await ensureSchema(client);
      const since = trendSinceIso(days);
      const res = await client.execute({
        sql: `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
              FROM events
              WHERE created_at >= ?
              GROUP BY day
              ORDER BY day`,
        args: [since],
      });
      return fillEventTrend(
        days,
        res.rows.map((r) => ({
          day: String(r.day),
          count: Number(r.count) || 0,
        })),
      );
    },

    async getOverview(days = 7): Promise<OverviewData> {
      const client = getClient();
      await ensureSchema(client);
      const safeDays = Math.min(Math.max(days, 1), 90);
      const since = overviewSince(safeDays);
      const [stats, trend, envRes, releaseRes, typeRes, pageRes, topRes, newIssueRes, newIssueCountRes] =
        await Promise.all([
        this.getIssueStats(),
        this.getEventTrend(safeDays),
        client.execute({ sql: OVERVIEW_BREAKDOWN_ENV_SQL, args: [since] }),
        client.execute({ sql: OVERVIEW_BREAKDOWN_RELEASE_SQL, args: [since] }),
        client.execute({ sql: OVERVIEW_BREAKDOWN_TYPE_SQL, args: [since] }),
        client.execute({ sql: OVERVIEW_BREAKDOWN_PAGE_SQL, args: [since] }),
        client.execute({ sql: OVERVIEW_TOP_ISSUES_SQL, args: [] }),
        client.execute({ sql: OVERVIEW_NEW_ISSUES_TREND_SQL, args: [since] }),
        client.execute({ sql: OVERVIEW_NEW_ISSUES_COUNT_SQL, args: [since] }),
      ]);
      return {
        stats,
        trend,
        days: safeDays,
        byEnvironment: mapBreakdownRows(
          envRes.rows.map((r) => ({ label: String(r.label), count: Number(r.count) })),
        ),
        byRelease: mapBreakdownRows(
          releaseRes.rows.map((r) => ({ label: String(r.label), count: Number(r.count) })),
        ),
        byType: mapBreakdownRows(
          typeRes.rows.map((r) => ({ label: String(r.label), count: Number(r.count) })),
        ),
        byPage: mapBreakdownRows(
          pageRes.rows.map((r) => ({ label: String(r.label), count: Number(r.count) })),
        ),
        topIssues: mapTopIssueRows(
          topRes.rows.map((r) => ({
            id: Number(r.id),
            title: String(r.title),
            type: String(r.type),
            count: Number(r.count),
          })),
        ),
        newIssueTrend: fillEventTrend(
          safeDays,
          newIssueRes.rows.map((r) => ({
            day: String(r.day),
            count: Number(r.count) || 0,
          })),
        ),
        newIssueCount: Number(newIssueCountRes.rows[0]?.count ?? 0),
      };
    },

    async getIssueById(id: number): Promise<Issue | null> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute({
        sql: `SELECT id, fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url
              FROM issues WHERE id = ?`,
        args: [id],
      });
      const row = res.rows[0];
      return row ? rowToIssue(row) : null;
    },

    async listEventsForIssue(issueId: number, limit = 50): Promise<EventRow[]> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute({
        sql: `SELECT id, issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at
              FROM events
              WHERE issue_id = ?
              ORDER BY created_at DESC
              LIMIT ?`,
        args: [issueId, limit],
      });
      return res.rows.map(rowToEvent);
    },

    async resolveIssue(id: number): Promise<boolean> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute({
        sql: `UPDATE issues SET status = 'resolved' WHERE id = ? AND status = 'open'`,
        args: [id],
      });
      return res.rowsAffected > 0;
    },

    async ignoreIssue(id: number): Promise<boolean> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute({
        sql: `UPDATE issues SET status = 'ignored' WHERE id = ? AND status = 'open'`,
        args: [id],
      });
      return res.rowsAffected > 0;
    },

    async reopenIssue(id: number): Promise<boolean> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute({
        sql: `UPDATE issues SET status = 'open' WHERE id = ? AND status IN ('resolved', 'ignored')`,
        args: [id],
      });
      return res.rowsAffected > 0;
    },

    async getWebhookConfig(): Promise<WebhookConfig> {
      const client = getClient();
      await ensureSchema(client);
      const res = await client.execute({
        sql: "SELECT value FROM settings WHERE key = ?",
        args: [WEBHOOK_SETTINGS_KEY],
      });
      const row = res.rows[0] as { value: string } | undefined;
      return parseWebhookConfig(row?.value);
    },

    async setWebhookConfig(config: WebhookConfig): Promise<void> {
      const client = getClient();
      await ensureSchema(client);
      await client.execute({
        sql: `INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [WEBHOOK_SETTINGS_KEY, serializeWebhookConfig(config)],
      });
    },
  };
}

function rowToIssue(row: Record<string, unknown>): Issue {
  return {
    id: Number(row.id),
    fingerprint: String(row.fingerprint),
    title: String(row.title),
    type: String(row.type),
    count: Number(row.count),
    status: row.status as Issue["status"],
    first_seen: String(row.first_seen),
    last_seen: String(row.last_seen),
    release: (row.release as string | null) ?? null,
    environment: (row.environment as string | null) ?? null,
    url: (row.url as string | null) ?? null,
  };
}

function rowToEvent(row: Record<string, unknown>): EventRow {
  return {
    id: Number(row.id),
    issue_id: Number(row.issue_id),
    message: String(row.message),
    type: String(row.type),
    stack: (row.stack as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    user_agent: (row.user_agent as string | null) ?? null,
    release: (row.release as string | null) ?? null,
    environment: (row.environment as string | null) ?? null,
    user_id: (row.user_id as string | null) ?? null,
    extra: parseExtra(row.extra),
    client: parseClient(row.client),
    client_ip: row.client_ip != null ? String(row.client_ip) : null,
    created_at: String(row.created_at),
  };
}
