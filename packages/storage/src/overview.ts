import type { EventTrendPoint, IssueStats } from "./types.js";
import { fillEventTrend, trendSinceIso } from "./eventTrend.js";

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

export const OVERVIEW_BREAKDOWN_ENV_SQL = `
  SELECT COALESCE(NULLIF(TRIM(environment), ''), '未知') AS label, COUNT(*) AS count
  FROM events
  WHERE created_at >= ?
  GROUP BY label
  ORDER BY count DESC
  LIMIT 8`;

export const OVERVIEW_BREAKDOWN_RELEASE_SQL = `
  SELECT COALESCE(NULLIF(TRIM(release), ''), '未知') AS label, COUNT(*) AS count
  FROM events
  WHERE created_at >= ?
  GROUP BY label
  ORDER BY count DESC
  LIMIT 8`;

export const OVERVIEW_BREAKDOWN_TYPE_SQL = `
  SELECT type AS label, COUNT(*) AS count
  FROM events
  WHERE created_at >= ?
  GROUP BY type
  ORDER BY count DESC
  LIMIT 8`;

export const OVERVIEW_BREAKDOWN_PAGE_SQL = `
  SELECT COALESCE(
    NULLIF(TRIM(json_extract(client, '$.page.path')), ''),
    NULLIF(TRIM(url), ''),
    '未知'
  ) AS label, COUNT(*) AS count
  FROM events
  WHERE created_at >= ?
  GROUP BY label
  ORDER BY count DESC
  LIMIT 8`;

export const OVERVIEW_NEW_ISSUES_TREND_SQL = `
  SELECT substr(first_seen, 1, 10) AS day, COUNT(*) AS count
  FROM issues
  WHERE first_seen >= ?
  GROUP BY day
  ORDER BY day`;

export const OVERVIEW_NEW_ISSUES_COUNT_SQL = `
  SELECT COUNT(*) AS count
  FROM issues
  WHERE first_seen >= ?`;

export const OVERVIEW_TOP_ISSUES_SQL = `
  SELECT id, title, type, count
  FROM issues
  WHERE status = 'open'
  ORDER BY count DESC
  LIMIT 5`;

export function overviewSince(days: number): string {
  return trendSinceIso(days);
}

export function mapBreakdownRows(
  rows: Array<{ label: string; count: number | null }>,
): OverviewBreakdownItem[] {
  return rows.map((row) => ({
    label: row.label,
    count: Number(row.count) || 0,
  }));
}

export function mapTopIssueRows(
  rows: Array<{ id: number; title: string; type: string; count: number | null }>,
): OverviewTopIssue[] {
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    type: row.type,
    count: Number(row.count) || 0,
  }));
}
