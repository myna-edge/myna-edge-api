export type WebhookFormat = "auto" | "feishu" | "wecom" | "slack" | "generic";

export type WebhookConfig = {
  enabled: boolean;
  url: string;
  format: WebhookFormat;
  /** Base URL of the console, e.g. https://myna.example.com */
  consoleUrl: string;
  notifyNew: boolean;
  notifyReopened: boolean;
};

export type WebhookAlertKind = "new" | "reopened";

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  url: "",
  format: "auto",
  consoleUrl: "",
  notifyNew: true,
  notifyReopened: true,
};

const FORMATS = new Set<WebhookFormat>(["auto", "feishu", "wecom", "slack", "generic"]);

export function isWebhookFormat(value: unknown): value is WebhookFormat {
  return typeof value === "string" && FORMATS.has(value as WebhookFormat);
}

export function parseWebhookConfig(raw: string | null | undefined): WebhookConfig {
  if (!raw?.trim()) return { ...DEFAULT_WEBHOOK_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      url: typeof parsed.url === "string" ? parsed.url.trim() : "",
      format: isWebhookFormat(parsed.format) ? parsed.format : "auto",
      consoleUrl: typeof parsed.consoleUrl === "string" ? parsed.consoleUrl.trim() : "",
      notifyNew: parsed.notifyNew !== false,
      notifyReopened: parsed.notifyReopened !== false,
    };
  } catch {
    return { ...DEFAULT_WEBHOOK_CONFIG };
  }
}

export function serializeWebhookConfig(config: WebhookConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    url: config.url.trim(),
    format: config.format,
    consoleUrl: config.consoleUrl.trim(),
    notifyNew: config.notifyNew,
    notifyReopened: config.notifyReopened,
  });
}

export function validateWebhookConfig(config: WebhookConfig): string | null {
  if (!config.enabled) return null;
  if (!config.url) return "启用告警时请填写 Webhook URL";
  try {
    const u = new URL(config.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "Webhook URL 须为 http 或 https";
    }
  } catch {
    return "Webhook URL 格式无效";
  }
  if (config.consoleUrl) {
    try {
      const u = new URL(config.consoleUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return "控制台地址须为 http 或 https";
      }
    } catch {
      return "控制台地址格式无效";
    }
  }
  return null;
}

export const WEBHOOK_SETTINGS_KEY = "webhook";
