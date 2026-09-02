export type IssueStatus = "open" | "resolved" | "ignored";

import type { ClientContext } from "./client.js";
import type { WebhookConfig } from "./webhook-config.js";

export type { ClientContext, StorageSnapshot } from "./client.js";

export type Issue = {
  id: number;
  fingerprint: string;
  title: string;
  type: string;
  count: number;
  status: IssueStatus;
  first_seen: string;
  last_seen: string;
  release: string | null;
  environment: string | null;
  url: string | null;
};

export type EventRow = {
  id: number;
  issue_id: number;
  message: string;
  type: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  release: string | null;
  environment: string | null;
  user_id: string | null;
  extra: Record<string, unknown> | null;
  client: ClientContext | null;
  client_ip: string | null;
  created_at: string;
};

export type IngestPayload = {
  message?: string;
  type?: string;
  stack?: string | null;
  url?: string | null;
  userAgent?: string | null;
  release?: string | null;
  environment?: string | null;
  userId?: string | null;
  extra?: Record<string, unknown> | null;
  client?: ClientContext | Record<string, unknown> | null;
  /** Set by API from request headers; not accepted from untrusted client body. */
  clientIp?: string | null;
  timestamp?: string | null;
};

export type StorageKind = "sqlite" | "d1" | "turso";

export type IssueStats = {
  openCount: number;
  resolvedCount: number;
  ignoredCount: number;
  openEvents: number;
};

export type EventTrendPoint = {
  day: string;
  count: number;
};

export type OverviewBreakdownItem = {
  label: string;
  count: number;
};

export type OverviewTopIssue = {
  id: number;
  title: string;
  type: string;
  count: number;
};

export type OverviewData = {
  stats: IssueStats;
  trend: EventTrendPoint[];
  days: number;
  byEnvironment: OverviewBreakdownItem[];
  byRelease: OverviewBreakdownItem[];
  byType: OverviewBreakdownItem[];
  byPage: OverviewBreakdownItem[];
  topIssues: OverviewTopIssue[];
  newIssueTrend: EventTrendPoint[];
  newIssueCount: number;
};

export type IssueSortField = "last_seen" | "first_seen" | "count" | "title";
export type IssueSortOrder = "asc" | "desc";
export type IssuePeriod = "today" | "yesterday" | "3d" | "7d" | "14d" | "30d";

export type IssueListQuery = {
  status?: IssueStatus;
  environment?: string;
  release?: string;
  q?: string;
  period?: IssuePeriod;
  sort?: IssueSortField;
  order?: IssueSortOrder;
  limit?: number;
  offset?: number;
};

export type IssueListResult = {
  issues: Issue[];
  total: number;
};

export type IssueFilterOptions = {
  environments: string[];
  releases: string[];
};

export type IngestResult = {
  issueId: number;
  fingerprint: string;
  /** Set when a webhook should fire: first occurrence or resolved → open again. */
  alert?: "new" | "reopened";
};

export type { WebhookAlertKind, WebhookConfig, WebhookFormat } from "./webhook-config.js";
export {
  DEFAULT_WEBHOOK_CONFIG,
  parseWebhookConfig,
  serializeWebhookConfig,
  validateWebhookConfig,
  WEBHOOK_SETTINGS_KEY,
} from "./webhook-config.js";

/** Pluggable persistence. Async so D1/Turso share the same callers. */
export interface StorageDriver {
  readonly kind: StorageKind;
  ingestEvent(payload: IngestPayload): Promise<IngestResult>;
  listIssues(query?: IssueListQuery): Promise<IssueListResult>;
  listFilterOptions(): Promise<IssueFilterOptions>;
  getIssueStats(): Promise<IssueStats>;
  getEventTrend(days?: number): Promise<EventTrendPoint[]>;
  getOverview(days?: number): Promise<OverviewData>;
  getIssueById(id: number): Promise<Issue | null>;
  listEventsForIssue(issueId: number, limit?: number): Promise<EventRow[]>;
  resolveIssue(id: number): Promise<boolean>;
  ignoreIssue(id: number): Promise<boolean>;
  reopenIssue(id: number): Promise<boolean>;
  getWebhookConfig(): Promise<WebhookConfig>;
  setWebhookConfig(config: WebhookConfig): Promise<void>;
}
