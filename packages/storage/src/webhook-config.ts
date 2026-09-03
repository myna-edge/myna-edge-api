export type WebhookConfig = {
  enabled: boolean;
  url: string;
  /** DingTalk robot sign secret (SEC…). Empty when using keyword auth. */
  signSecret: string;
  /** Base URL of the console, e.g. https://myna.example.com */
  consoleUrl: string;
  notifyNew: boolean;
  notifyReopened: boolean;
};

export type WebhookAlertKind = "new" | "reopened";

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  url: "",
  signSecret: "",
  consoleUrl: "",
  notifyNew: true,
  notifyReopened: true,
};

export function parseWebhookConfig(raw: string | null | undefined): WebhookConfig {
  if (!raw?.trim()) return { ...DEFAULT_WEBHOOK_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      url: typeof parsed.url === "string" ? parsed.url.trim() : "",
      signSecret: typeof parsed.signSecret === "string" ? parsed.signSecret.trim() : "",
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
    signSecret: config.signSecret.trim(),
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
