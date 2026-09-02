/** Strip absolute URLs and line:col so the same bug collapses to one fingerprint. */
export function normalizeStack(stack: string | null | undefined): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .map((line) =>
      line
        .replace(/https?:\/\/[^\s)]+/g, "<url>")
        .replace(/:\d+:\d+/g, ":?:?")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Web Crypto — works in Node and Cloudflare Workers. */
export async function fingerprintOf(
  message: string,
  stack?: string | null,
): Promise<string> {
  const material = `${message.trim()}\n${normalizeStack(stack)}`;
  const data = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest).slice(0, 16);
}
