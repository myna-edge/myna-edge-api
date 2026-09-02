import type { EventTrendPoint } from "./types.js";

/** Build a continuous day series (UTC dates as YYYY-MM-DD), filling gaps with 0. */
export function fillEventTrend(
  days: number,
  rows: Array<{ day: string; count: number }>,
  now = new Date(),
): EventTrendPoint[] {
  const safeDays = Math.min(Math.max(days, 1), 90);
  const byDay = new Map(rows.map((r) => [r.day, Number(r.count) || 0]));
  const result: EventTrendPoint[] = [];

  for (let i = safeDays - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const day = d.toISOString().slice(0, 10);
    result.push({ day, count: byDay.get(day) ?? 0 });
  }
  return result;
}

export function trendSinceIso(days: number, now = new Date()): string {
  const safeDays = Math.min(Math.max(days, 1), 90);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (safeDays - 1)));
  return d.toISOString();
}
