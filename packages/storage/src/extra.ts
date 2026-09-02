const MAX_EXTRA_BYTES = 8 * 1024;

export function serializeExtra(extra: unknown): string | null {
  if (extra == null || typeof extra !== "object" || Array.isArray(extra)) return null;
  const entries = Object.entries(extra as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return null;
  try {
    const json = JSON.stringify(Object.fromEntries(entries));
    if (!json || json === "{}") return null;
    if (json.length > MAX_EXTRA_BYTES) return null;
    return json;
  } catch {
    return null;
  }
}

export function parseExtra(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}