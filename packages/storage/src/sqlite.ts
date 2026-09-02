import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

const globalForDb = globalThis as unknown as { __mynaSqlite?: Database.Database };

function repoRoot(): string {
  // packages/storage/src -> api repo root
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

function dbFilePath() {
  if (process.env.MYNA_SQLITE_PATH) return process.env.MYNA_SQLITE_PATH;
  return path.join(repoRoot(), "data", "myna.db");
}

function getSqlite(): Database.Database {
  if (globalForDb.__mynaSqlite) return globalForDb.__mynaSqlite;

  fs.mkdirSync(path.dirname(dbFilePath()), { recursive: true });
  const db = new Database(dbFilePath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  for (const sql of SCHEMA_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (error) {
      if (!isIgnorableMigrationError(error)) throw error;
    }
  }
  globalForDb.__mynaSqlite = db;
  return db;
}

export function createSqliteDriver(): StorageDriver {
  return {
    kind: "sqlite",

    async ingestEvent(payload: IngestPayload): Promise<IngestResult> {
      const db = getSqlite();
      const now = payload.timestamp || new Date().toISOString();
      const message = (payload.message || "Unknown error").trim() || "Unknown error";
      const type = (payload.type || "error").trim() || "error";
      const stack = payload.stack ?? null;
      const fingerprint = await fingerprintOf(message, stack);

      const existing = db
        .prepare("SELECT id, status FROM issues WHERE fingerprint = ?")
        .get(fingerprint) as { id: number; status: string } | undefined;

      const tx = db.transaction(() => {
        let issueId: number;
        if (existing) {
          issueId = existing.id;
          db.prepare(
            `UPDATE issues
             SET count = count + 1,
                 last_seen = ?,
                 title = ?,
                 type = ?,
                 release = COALESCE(?, release),
                 environment = COALESCE(?, environment),
                 url = COALESCE(?, url),
                 status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
             WHERE id = ?`,
          ).run(
            now,
            message,
            type,
            payload.release ?? null,
            payload.environment ?? null,
            payload.url ?? null,
            issueId,
          );
        } else {
          const info = db
            .prepare(
              `INSERT INTO issues
                (fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url)
               VALUES (?, ?, ?, 1, 'open', ?, ?, ?, ?, ?)`,
            )
            .run(
              fingerprint,
              message,
              type,
              now,
              now,
              payload.release ?? null,
              payload.environment ?? null,
              payload.url ?? null,
            );
          issueId = Number(info.lastInsertRowid);
        }

        const extra = serializeExtra(payload.extra);
        const client = serializeClient(payload.client);

        db.prepare(
          `INSERT INTO events
            (issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          issueId,
          message,
          type,
          stack,
          payload.url ?? null,
          payload.userAgent ?? null,
          payload.release ?? null,
          payload.environment ?? null,
          payload.userId ?? null,
          extra,
          client,
          payload.clientIp ?? null,
          now,
        );

        return {
          issueId,
          fingerprint,
          alert: !existing ? "new" : existing.status === "resolved" ? "reopened" : undefined,
        };
      });

      return tx();
    },

    async listIssues(query: IssueListQuery = {}): Promise<IssueListResult> {
      const { where, args, limit, offset, orderBy } = normalizeIssueListQuery(query);
      const db = getSqlite();
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${where}`)
        .get(...args) as { total: number };
      const issues = db
        .prepare(
          `${ISSUE_LIST_SELECT}
           FROM issues
           WHERE ${where}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset) as Issue[];
      return { issues, total: Number(totalRow?.total ?? 0) };
    },

    async listFilterOptions(): Promise<IssueFilterOptions> {
      const envs = getSqlite()
        .prepare(
          `SELECT DISTINCT environment AS value FROM issues
           WHERE environment IS NOT NULL AND environment != ''
           ORDER BY environment`,
        )
        .all() as { value: string }[];
      const releases = getSqlite()
        .prepare(
          `SELECT DISTINCT release AS value FROM issues
           WHERE release IS NOT NULL AND release != ''
           ORDER BY release`,
        )
        .all() as { value: string }[];
      return {
        environments: envs.map((r) => r.value),
        releases: releases.map((r) => r.value),
      };
    },

    async getIssueStats(): Promise<IssueStats> {
      const row = getSqlite()
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
             SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
             COALESCE(SUM(CASE WHEN status = 'open' THEN count ELSE 0 END), 0) AS open_events
           FROM issues`,
        )
        .get() as {
        open_count: number | null;
        resolved_count: number | null;
        ignored_count: number | null;
        open_events: number | null;
      };

      return {
        openCount: row.open_count ?? 0,
        resolvedCount: row.resolved_count ?? 0,
        ignoredCount: row.ignored_count ?? 0,
        openEvents: row.open_events ?? 0,
      };
    },

    async getEventTrend(days = 7): Promise<EventTrendPoint[]> {
      const since = trendSinceIso(days);
      const rows = getSqlite()
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
           FROM events
           WHERE created_at >= ?
           GROUP BY day
           ORDER BY day`,
        )
        .all(since) as { day: string; count: number }[];
      return fillEventTrend(days, rows);
    },

    async getOverview(days = 7): Promise<OverviewData> {
      const safeDays = Math.min(Math.max(days, 1), 90);
      const since = overviewSince(safeDays);
      const db = getSqlite();
      const [stats, trend, byEnvironment, byRelease, byType, byPage, topIssues, newIssueRows, newIssueCountRow] =
        await Promise.all([
        this.getIssueStats(),
        this.getEventTrend(safeDays),
        Promise.resolve(
          mapBreakdownRows(
            db.prepare(OVERVIEW_BREAKDOWN_ENV_SQL).all(since) as Array<{
              label: string;
              count: number | null;
            }>,
          ),
        ),
        Promise.resolve(
          mapBreakdownRows(
            db.prepare(OVERVIEW_BREAKDOWN_RELEASE_SQL).all(since) as Array<{
              label: string;
              count: number | null;
            }>,
          ),
        ),
        Promise.resolve(
          mapBreakdownRows(
            db.prepare(OVERVIEW_BREAKDOWN_TYPE_SQL).all(since) as Array<{
              label: string;
              count: number | null;
            }>,
          ),
        ),
        Promise.resolve(
          mapBreakdownRows(
            db.prepare(OVERVIEW_BREAKDOWN_PAGE_SQL).all(since) as Array<{
              label: string;
              count: number | null;
            }>,
          ),
        ),
        Promise.resolve(
          mapTopIssueRows(
            db.prepare(OVERVIEW_TOP_ISSUES_SQL).all() as Array<{
              id: number;
              title: string;
              type: string;
              count: number | null;
            }>,
          ),
        ),
        Promise.resolve(
          db.prepare(OVERVIEW_NEW_ISSUES_TREND_SQL).all(since) as Array<{
            day: string;
            count: number | null;
          }>,
        ),
        Promise.resolve(
          db.prepare(OVERVIEW_NEW_ISSUES_COUNT_SQL).get(since) as { count: number | null },
        ),
      ]);
      return {
        stats,
        trend,
        days: safeDays,
        byEnvironment,
        byRelease,
        byType,
        byPage,
        topIssues,
        newIssueTrend: fillEventTrend(safeDays, newIssueRows),
        newIssueCount: Number(newIssueCountRow?.count ?? 0),
      };
    },

    async getIssueById(id: number): Promise<Issue | null> {
      const row = getSqlite()
        .prepare(
          `SELECT id, fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url
           FROM issues WHERE id = ?`,
        )
        .get(id) as Issue | undefined;
      return row ?? null;
    },

    async listEventsForIssue(issueId: number, limit = 50): Promise<EventRow[]> {
      return getSqlite()
        .prepare(
          `SELECT id, issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at
           FROM events
           WHERE issue_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(issueId, limit)
        .map((row) => ({
          ...(row as Omit<EventRow, "extra" | "client">),
          extra: parseExtra((row as { extra?: unknown }).extra),
          client: parseClient((row as { client?: unknown }).client),
          client_ip: ((row as { client_ip?: string | null }).client_ip as string | null) ?? null,
        }));
    },

    async resolveIssue(id: number): Promise<boolean> {
      const info = getSqlite()
        .prepare(`UPDATE issues SET status = 'resolved' WHERE id = ? AND status = 'open'`)
        .run(id);
      return info.changes > 0;
    },

    async ignoreIssue(id: number): Promise<boolean> {
      const info = getSqlite()
        .prepare(`UPDATE issues SET status = 'ignored' WHERE id = ? AND status = 'open'`)
        .run(id);
      return info.changes > 0;
    },

    async reopenIssue(id: number): Promise<boolean> {
      const info = getSqlite()
        .prepare(
          `UPDATE issues SET status = 'open' WHERE id = ? AND status IN ('resolved', 'ignored')`,
        )
        .run(id);
      return info.changes > 0;
    },

    async getWebhookConfig(): Promise<WebhookConfig> {
      const row = getSqlite()
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(WEBHOOK_SETTINGS_KEY) as { value: string } | undefined;
      return parseWebhookConfig(row?.value);
    },

    async setWebhookConfig(config: WebhookConfig): Promise<void> {
      getSqlite()
        .prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(WEBHOOK_SETTINGS_KEY, serializeWebhookConfig(config));
    },
  };
}
