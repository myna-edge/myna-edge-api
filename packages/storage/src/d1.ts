import { fingerprintOf } from "./fingerprint.js";
import { SCHEMA_MIGRATIONS, SCHEMA_STATEMENTS, isIgnorableMigrationError } from "./schema.js";
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

/** Minimal D1 surface so we don't depend on workers-types globally. */
export type D1Binding = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
};

const globalForD1 = globalThis as unknown as {
  __mynaD1?: D1Binding;
  __mynaD1Ready?: Promise<void>;
};

export function setD1Binding(db: D1Binding) {
  globalForD1.__mynaD1 = db;
  globalForD1.__mynaD1Ready = undefined;
}

export function getD1Binding(): D1Binding | null {
  return globalForD1.__mynaD1 ?? null;
}

async function ensureSchema(db: D1Binding) {
  if (!globalForD1.__mynaD1Ready) {
    globalForD1.__mynaD1Ready = (async () => {
      // D1 exec() cannot run our multi-statement DDL in one call.
      for (const sql of SCHEMA_STATEMENTS) {
        await db.prepare(sql).run();
      }
      for (const sql of SCHEMA_MIGRATIONS) {
        try {
          await db.prepare(sql).run();
        } catch (error) {
          if (!isIgnorableMigrationError(error)) throw error;
        }
      }
    })();
  }
  await globalForD1.__mynaD1Ready;
}

export function createD1Driver(db: D1Binding): StorageDriver {
  return {
    kind: "d1",

    async ingestEvent(payload: IngestPayload): Promise<IngestResult> {
      await ensureSchema(db);
      const now = payload.timestamp || new Date().toISOString();
      const message = (payload.message || "Unknown error").trim() || "Unknown error";
      const type = (payload.type || "error").trim() || "error";
      const stack = payload.stack ?? null;
      const fingerprint = await fingerprintOf(message, stack);

      const existing = await db
        .prepare("SELECT id, status FROM issues WHERE fingerprint = ?")
        .bind(fingerprint)
        .first<{ id: number; status: string }>();

      if (existing) {
        const issueId = Number(existing.id);
        await db.batch([
          db
            .prepare(
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
            )
            .bind(
              now,
              message,
              type,
              payload.release ?? null,
              payload.environment ?? null,
              payload.url ?? null,
              issueId,
            ),
          db
            .prepare(
              `INSERT INTO events
                (issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
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
            ),
        ]);
        return {
          issueId,
          fingerprint,
          alert: existing.status === "resolved" ? "reopened" : undefined,
        };
      }

      const inserted = await db
        .prepare(
          `INSERT INTO issues
            (fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url)
           VALUES (?, ?, ?, 1, 'open', ?, ?, ?, ?, ?)`,
        )
        .bind(
          fingerprint,
          message,
          type,
          now,
          now,
          payload.release ?? null,
          payload.environment ?? null,
          payload.url ?? null,
        )
        .run();
      const issueId = Number(inserted.meta.last_row_id);
      await db
        .prepare(
          `INSERT INTO events
            (issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
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
        )
        .run();
      return { issueId, fingerprint, alert: "new" };
    },

    async listIssues(query: IssueListQuery = {}): Promise<IssueListResult> {
      await ensureSchema(db);
      const { where, args, limit, offset, orderBy } = normalizeIssueListQuery(query);
      const totalRow = await db
        .prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${where}`)
        .bind(...args)
        .first<{ total: number }>();
      const res = await db
        .prepare(
          `${ISSUE_LIST_SELECT}
           FROM issues
           WHERE ${where}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
        )
        .bind(...args, limit, offset)
        .all<Record<string, unknown>>();
      return {
        issues: res.results.map(rowToIssue),
        total: Number(totalRow?.total ?? 0),
      };
    },

    async listFilterOptions(): Promise<IssueFilterOptions> {
      await ensureSchema(db);
      const envs = await db
        .prepare(
          `SELECT DISTINCT environment AS value FROM issues
           WHERE environment IS NOT NULL AND environment != ''
           ORDER BY environment`,
        )
        .all<{ value: string }>();
      const releases = await db
        .prepare(
          `SELECT DISTINCT release AS value FROM issues
           WHERE release IS NOT NULL AND release != ''
           ORDER BY release`,
        )
        .all<{ value: string }>();
      return {
        environments: envs.results.map((r) => r.value),
        releases: releases.results.map((r) => r.value),
      };
    },

    async getIssueStats(): Promise<IssueStats> {
      await ensureSchema(db);
      const row = await db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
             SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
             SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
             COALESCE(SUM(CASE WHEN status = 'open' THEN count ELSE 0 END), 0) AS open_events
           FROM issues`,
        )
        .first<{
          open_count: number | null;
          resolved_count: number | null;
          ignored_count: number | null;
          open_events: number | null;
        }>();
      return {
        openCount: Number(row?.open_count ?? 0),
        resolvedCount: Number(row?.resolved_count ?? 0),
        ignoredCount: Number(row?.ignored_count ?? 0),
        openEvents: Number(row?.open_events ?? 0),
      };
    },

    async getEventTrend(days = 7): Promise<EventTrendPoint[]> {
      await ensureSchema(db);
      const since = trendSinceIso(days);
      const res = await db
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
           FROM events
           WHERE created_at >= ?
           GROUP BY day
           ORDER BY day`,
        )
        .bind(since)
        .all<{ day: string; count: number }>();
      return fillEventTrend(
        days,
        res.results.map((r) => ({ day: r.day, count: Number(r.count) || 0 })),
      );
    },

    async getOverview(days = 7): Promise<OverviewData> {
      await ensureSchema(db);
      const safeDays = Math.min(Math.max(days, 1), 90);
      const since = overviewSince(safeDays);
      const [stats, trend, envRes, releaseRes, typeRes, pageRes, topRes, newIssueRes, newIssueCountRes] =
        await Promise.all([
        this.getIssueStats(),
        this.getEventTrend(safeDays),
        db.prepare(OVERVIEW_BREAKDOWN_ENV_SQL).bind(since).all<{ label: string; count: number }>(),
        db
          .prepare(OVERVIEW_BREAKDOWN_RELEASE_SQL)
          .bind(since)
          .all<{ label: string; count: number }>(),
        db.prepare(OVERVIEW_BREAKDOWN_TYPE_SQL).bind(since).all<{ label: string; count: number }>(),
        db.prepare(OVERVIEW_BREAKDOWN_PAGE_SQL).bind(since).all<{ label: string; count: number }>(),
        db.prepare(OVERVIEW_TOP_ISSUES_SQL).all<{
          id: number;
          title: string;
          type: string;
          count: number;
        }>(),
        db.prepare(OVERVIEW_NEW_ISSUES_TREND_SQL).bind(since).all<{ day: string; count: number }>(),
        db.prepare(OVERVIEW_NEW_ISSUES_COUNT_SQL).bind(since).first<{ count: number }>(),
      ]);
      return {
        stats,
        trend,
        days: safeDays,
        byEnvironment: mapBreakdownRows(envRes.results),
        byRelease: mapBreakdownRows(releaseRes.results),
        byType: mapBreakdownRows(typeRes.results),
        byPage: mapBreakdownRows(pageRes.results),
        topIssues: mapTopIssueRows(topRes.results),
        newIssueTrend: fillEventTrend(
          safeDays,
          newIssueRes.results.map((r) => ({ day: r.day, count: Number(r.count) || 0 })),
        ),
        newIssueCount: Number(newIssueCountRes?.count ?? 0),
      };
    },

    async getIssueById(id: number): Promise<Issue | null> {
      await ensureSchema(db);
      const row = await db
        .prepare(
          `SELECT id, fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url
           FROM issues WHERE id = ?`,
        )
        .bind(id)
        .first<Record<string, unknown>>();
      return row ? rowToIssue(row) : null;
    },

    async listEventsForIssue(issueId: number, limit = 50): Promise<EventRow[]> {
      await ensureSchema(db);
      const res = await db
        .prepare(
          `SELECT id, issue_id, message, type, stack, url, user_agent, release, environment, user_id, extra, client, client_ip, created_at
           FROM events
           WHERE issue_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .bind(issueId, limit)
        .all<Record<string, unknown>>();
      return res.results.map(rowToEvent);
    },

    async resolveIssue(id: number): Promise<boolean> {
      await ensureSchema(db);
      const res = await db
        .prepare(`UPDATE issues SET status = 'resolved' WHERE id = ? AND status = 'open'`)
        .bind(id)
        .run();
      return res.meta.changes > 0;
    },

    async ignoreIssue(id: number): Promise<boolean> {
      await ensureSchema(db);
      const res = await db
        .prepare(`UPDATE issues SET status = 'ignored' WHERE id = ? AND status = 'open'`)
        .bind(id)
        .run();
      return res.meta.changes > 0;
    },

    async reopenIssue(id: number): Promise<boolean> {
      await ensureSchema(db);
      const res = await db
        .prepare(
          `UPDATE issues SET status = 'open' WHERE id = ? AND status IN ('resolved', 'ignored')`,
        )
        .bind(id)
        .run();
      return res.meta.changes > 0;
    },

    async getWebhookConfig(): Promise<WebhookConfig> {
      await ensureSchema(db);
      const row = await db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .bind(WEBHOOK_SETTINGS_KEY)
        .first<{ value: string }>();
      return parseWebhookConfig(row?.value);
    },

    async setWebhookConfig(config: WebhookConfig): Promise<void> {
      await ensureSchema(db);
      await db
        .prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .bind(WEBHOOK_SETTINGS_KEY, serializeWebhookConfig(config))
        .run();
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
    client_ip: (row.client_ip as string | null) ?? null,
    created_at: String(row.created_at),
  };
}
