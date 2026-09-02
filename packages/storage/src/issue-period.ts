import type { IssuePeriod } from "./types.js";

export const ISSUE_PERIODS: IssuePeriod[] = [
  "today",
  "yesterday",
  "3d",
  "7d",
  "14d",
  "30d",
];

function startOfUtcDay(now: Date, daysAgo: number): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo),
  );
  return d.toISOString();
}

export type IssuePeriodBounds = {
  since?: string;
  until?: string;
};

/** Map preset period to UTC bounds on `last_seen` (ISO string compare). */
export function resolveIssuePeriodBounds(
  period?: string,
  now = new Date(),
): IssuePeriodBounds | null {
  if (!period) return null;

  switch (period) {
    case "today":
      return { since: startOfUtcDay(now, 0) };
    case "yesterday":
      return { since: startOfUtcDay(now, 1), until: startOfUtcDay(now, 0) };
    case "3d":
      return { since: startOfUtcDay(now, 2) };
    case "7d":
      return { since: startOfUtcDay(now, 6) };
    case "14d":
      return { since: startOfUtcDay(now, 13) };
    case "30d":
      return { since: startOfUtcDay(now, 29) };
    default:
      return null;
  }
}

export function isIssuePeriod(value: string): value is IssuePeriod {
  return (ISSUE_PERIODS as string[]).includes(value);
}
