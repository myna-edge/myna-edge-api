import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  getStorage,
  validateWebhookConfig,
  enrichIngestPayload,
  extractRequestMeta,
  type IngestPayload,
  type WebhookConfig,
} from "@myna-edge/storage";
import { dispatchIssueAlert, sendWebhook } from "./webhook.js";

function expectedSecret(): string | null {
  const value = process.env.MYNA_SECRET?.trim();
  return value || null;
}

function extractBearerToken(c: Context): string | null {
  const headerToken = c.req.header("x-myna-admin-token")?.trim();
  if (headerToken) return headerToken;

  const auth = c.req.header("authorization")?.trim();
  if (auth) {
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer?.[1]) return bearer[1].trim();
  }
  return null;
}

function requireAdmin(c: Context): Response | null {
  const expected = expectedSecret();
  if (!expected) return null;
  const got = extractBearerToken(c);
  if (got !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return null;
}

function extractIngestToken(
  c: Context,
  payload: IngestPayload & { token?: string },
): string | null {
  const headerToken = c.req.header("x-myna-token")?.trim();
  if (headerToken) return headerToken;

  const auth = c.req.header("authorization")?.trim();
  if (auth) {
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer?.[1]) return bearer[1].trim();
  }

  const queryToken = c.req.query("token")?.trim();
  if (queryToken) return queryToken;

  if (typeof payload.token === "string" && payload.token.trim()) {
    return payload.token.trim();
  }
  return null;
}

function stripUntrustedIngestFields<T extends IngestPayload & { token?: string }>(
  payload: T,
): Omit<T, "token" | "clientIp"> {
  const { token: _token, clientIp: _clientIp, ...rest } = payload;
  if (rest.client && typeof rest.client === "object" && !Array.isArray(rest.client)) {
    const client = { ...rest.client } as Record<string, unknown>;
    delete client.request;
    rest.client = client;
  }
  return rest;
}

function normalizeWebhookInput(body: Partial<WebhookConfig>): WebhookConfig {
  return {
    enabled: Boolean(body.enabled),
    url: typeof body.url === "string" ? body.url.trim() : "",
    signSecret: typeof body.signSecret === "string" ? body.signSecret.trim() : "",
    consoleUrl: typeof body.consoleUrl === "string" ? body.consoleUrl.trim() : "",
    notifyNew: body.notifyNew !== false,
    notifyReopened: body.notifyReopened !== false,
  };
}

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "PUT", "POST", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Myna-Token", "X-Myna-Admin-Token", "Authorization"],
    }),
  );

  app.get("/api/health", async (c) => {
    const storage = await getStorage();
    const webhook = await storage.getWebhookConfig();
    return c.json({
      ok: true,
      storage: process.env.MYNA_STORAGE || "sqlite",
      ingestAuth: Boolean(expectedSecret()),
      adminAuth: Boolean(expectedSecret()),
      webhook: webhook.enabled && Boolean(webhook.url),
    });
  });

  app.get("/api/settings/webhook", async (c) => {
    const config = await (await getStorage()).getWebhookConfig();
    return c.json({ config });
  });

  app.put("/api/settings/webhook", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    let body: Partial<WebhookConfig>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const config = normalizeWebhookInput(body);
    const error = validateWebhookConfig(config);
    if (error) return c.json({ error }, 400);
    await (await getStorage()).setWebhookConfig(config);
    return c.json({ ok: true, config });
  });

  app.post("/api/settings/webhook/test", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const storage = await getStorage();
    const config = await storage.getWebhookConfig();
    const error = validateWebhookConfig({ ...config, enabled: true });
    if (error) return c.json({ error }, 400);
    try {
      await sendWebhook({ ...config, enabled: true }, { alert: "test" });
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "webhook test failed";
      return c.json({ error: message }, 502);
    }
  });

  app.post("/api/ingest", async (c) => {
    try {
      const contentType = c.req.header("content-type") || "";
      let payload: IngestPayload & { token?: string };
      if (contentType.includes("application/json")) {
        payload = await c.req.json();
      } else {
        const text = await c.req.text();
        payload = text.trim() ? (JSON.parse(text) as IngestPayload & { token?: string }) : {};
      }

      const expected = expectedSecret();
      if (expected) {
        const got = extractIngestToken(c, payload);
        if (got !== expected) {
          return c.json({ ok: false, error: "unauthorized" }, 401);
        }
      }

      const storage = await getStorage();
      const requestMeta = extractRequestMeta((name) => c.req.header(name), c.req.method);
      const enriched = enrichIngestPayload(stripUntrustedIngestFields(payload), requestMeta);
      const result = await storage.ingestEvent(enriched);

      if (result.alert) {
        void (async () => {
          try {
            const [config, issue] = await Promise.all([
              storage.getWebhookConfig(),
              storage.getIssueById(result.issueId),
            ]);
            if (issue) await dispatchIssueAlert(config, result.alert!, issue);
          } catch {
            // webhook failures must not affect ingest
          }
        })();
      }

      return c.json({ ok: true, ...result }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ingest failed";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/issues", async (c) => {
    const statusRaw = c.req.query("status") || "open";
    if (statusRaw !== "open" && statusRaw !== "resolved" && statusRaw !== "ignored") {
      return c.json({ error: 'status must be "open", "resolved", or "ignored"' }, 400);
    }
    const environment = c.req.query("environment")?.trim() || undefined;
    const release = c.req.query("release")?.trim() || undefined;
    const q = c.req.query("q")?.trim() || undefined;
    const sortRaw = c.req.query("sort")?.trim() || undefined;
    const orderRaw = c.req.query("order")?.trim() || undefined;
    const sort =
      sortRaw === "last_seen" ||
      sortRaw === "first_seen" ||
      sortRaw === "count" ||
      sortRaw === "title"
        ? sortRaw
        : undefined;
    const order = orderRaw === "asc" || orderRaw === "desc" ? orderRaw : undefined;
    const periodRaw = c.req.query("period")?.trim() || undefined;
    const period =
      periodRaw === "today" ||
      periodRaw === "yesterday" ||
      periodRaw === "3d" ||
      periodRaw === "7d" ||
      periodRaw === "14d" ||
      periodRaw === "30d"
        ? periodRaw
        : undefined;
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 100);
    const page = Math.max(Number(c.req.query("page")) || 1, 1);
    const offset = (page - 1) * limit;

    const storage = await getStorage();
    const [list, stats, filters] = await Promise.all([
      storage.listIssues({ status: statusRaw, environment, release, q, period, sort, order, limit, offset }),
      storage.getIssueStats(),
      storage.listFilterOptions(),
    ]);
    return c.json({
      issues: list.issues,
      total: list.total,
      page,
      limit,
      stats,
      filters,
    });
  });

  app.get("/api/overview", async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days")) || 7, 1), 90);
    const storage = await getStorage();
    return c.json(await storage.getOverview(days));
  });

  app.get("/api/issues/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const storage = await getStorage();
    const issue = await storage.getIssueById(id);
    if (!issue) return c.json({ error: "not found" }, 404);
    const events = await storage.listEventsForIssue(id);
    return c.json({ issue, events });
  });

  app.patch("/api/issues/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

    let status: "resolved" | "ignored" | "open" = "resolved";
    const raw = await c.req.text();
    if (raw.trim()) {
      try {
        const body = JSON.parse(raw) as { status?: string };
        if (body.status === "ignored" || body.status === "resolved" || body.status === "open") {
          status = body.status;
        } else if (body.status) {
          return c.json({ error: 'status must be "resolved", "ignored", or "open"' }, 400);
        }
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }
    }

    const storage = await getStorage();
    const ok =
      status === "ignored"
        ? await storage.ignoreIssue(id)
        : status === "open"
          ? await storage.reopenIssue(id)
          : await storage.resolveIssue(id);
    if (!ok) {
      return c.json({ error: "not found or cannot apply status" }, 404);
    }
    return c.json({ ok: true, status });
  });

  return app;
}
