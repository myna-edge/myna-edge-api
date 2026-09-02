import type { ClientContext } from "./client.js";

export type RequestMeta = NonNullable<ClientContext["request"]>;

type HeaderGetter = (name: string) => string | undefined;

const CF_HEADER_KEYS = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-timezone",
  "cf-visitor",
  "cf-ipcity",
  "cf-region",
  "cf-ipcontinent",
] as const;

function firstForwardedIp(forwarded: string | undefined): string | undefined {
  if (!forwarded) return undefined;
  const first = forwarded.split(",")[0]?.trim();
  return first || undefined;
}

function pickCfHeaders(get: HeaderGetter): Record<string, string> | undefined {
  const cf: Record<string, string> = {};
  for (const key of CF_HEADER_KEYS) {
    const value = get(key);
    if (value) cf[key.replace(/^cf-/, "")] = value;
  }
  return Object.keys(cf).length > 0 ? cf : undefined;
}

/** Resolve client IP from proxy / Cloudflare headers. */
export function resolveClientIp(get: HeaderGetter): string | undefined {
  return (
    get("cf-connecting-ip") ||
    get("x-real-ip") ||
    firstForwardedIp(get("x-forwarded-for")) ||
    get("x-client-ip") ||
    undefined
  );
}

/** HTTP request metadata captured server-side at ingest (never trust client body for IP). */
export function extractRequestMeta(
  get: HeaderGetter,
  method = "POST",
): RequestMeta {
  const forwardedFor = get("x-forwarded-for");
  return {
    ip: resolveClientIp(get),
    forwardedFor,
    realIp: get("x-real-ip"),
    acceptLanguage: get("accept-language"),
    acceptEncoding: get("accept-encoding"),
    referer: get("referer"),
    origin: get("origin"),
    host: get("host"),
    method,
    cf: pickCfHeaders(get),
  };
}

export function mergeClientWithRequest(
  client: ClientContext | Record<string, unknown> | null | undefined,
  request: RequestMeta,
): ClientContext {
  const base =
    client && typeof client === "object" && !Array.isArray(client)
      ? ({ ...client } as ClientContext)
      : {};
  return { ...base, request };
}

export function enrichIngestPayload<T extends { client?: unknown; clientIp?: string | null }>(
  payload: T,
  request: RequestMeta,
): T & { client: ClientContext; clientIp: string | null } {
  return {
    ...payload,
    client: mergeClientWithRequest(
      payload.client as ClientContext | Record<string, unknown> | null | undefined,
      request,
    ),
    clientIp: request.ip ?? null,
  };
}
