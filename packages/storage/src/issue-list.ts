import type { IssueListQuery, IssueSortField, IssueSortOrder, IssueStatus } from "./types.js";
import { resolveIssuePeriodBounds } from "./issue-period.js";

export type NormalizedIssueListQuery = {
  status: IssueStatus;
  limit: number;
  offset: number;
  where: string;
  args: (string | number)[];
  orderBy: string;
};

const SORT_COLUMNS: Record<IssueSortField, string> = {
  last_seen: "last_seen",
  first_seen: "first_seen",
  count: "count",
  title: "title",
};

export function resolveIssueListOrderBy(
  sort?: string,
  order?: string,
): { field: IssueSortField; order: IssueSortOrder; sql: string } {
  const field: IssueSortField =
    sort && sort in SORT_COLUMNS ? (sort as IssueSortField) : "last_seen";
  const dir: IssueSortOrder = order === "asc" ? "asc" : "desc";
  return {
    field,
    order: dir,
    sql: `${SORT_COLUMNS[field]} ${dir === "asc" ? "ASC" : "DESC"}`,
  };
}

export function normalizeIssueListQuery(query: IssueListQuery = {}): NormalizedIssueListQuery {
  const status = query.status ?? "open";
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  const clauses = ["status = ?"];
  const args: (string | number)[] = [status];

  if (query.environment) {
    clauses.push("environment = ?");
    args.push(query.environment);
  }
  if (query.release) {
    clauses.push("release = ?");
    args.push(query.release);
  }
  if (query.q?.trim()) {
    const term = `%${query.q.trim().replace(/[%_]/g, "")}%`;
    clauses.push("(title LIKE ? OR fingerprint LIKE ? OR type LIKE ? OR url LIKE ?)");
    args.push(term, term, term, term);
  }

  const periodBounds = resolveIssuePeriodBounds(query.period);
  if (periodBounds?.since) {
    clauses.push("last_seen >= ?");
    args.push(periodBounds.since);
  }
  if (periodBounds?.until) {
    clauses.push("last_seen < ?");
    args.push(periodBounds.until);
  }

  const { sql: orderBy } = resolveIssueListOrderBy(query.sort, query.order);

  return {
    status,
    limit,
    offset,
    where: clauses.join(" AND "),
    args,
    orderBy,
  };
}

export const ISSUE_LIST_SELECT = `SELECT id, fingerprint, title, type, count, status, first_seen, last_seen, release, environment, url`;
