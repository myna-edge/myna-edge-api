import type { Issue, WebhookAlertKind, WebhookConfig } from "@myna-edge/storage";

export type WebhookPayload = {
  alert: WebhookAlertKind | "test";
  issue?: Issue;
  consoleUrl?: string;
};

type ResolvedFormat = "feishu" | "wecom" | "dingtalk" | "generic";

function resolveFormat(url: string): ResolvedFormat {
  const lower = url.toLowerCase();
  if (lower.includes("open.feishu.cn") || lower.includes("open.larksuite.com")) return "feishu";
  if (lower.includes("qyapi.weixin.qq.com")) return "wecom";
  if (lower.includes("oapi.dingtalk.com")) return "dingtalk";
  return "generic";
}

function issueLink(config: WebhookConfig, issueId: number): string | null {
  const base = config.consoleUrl.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/issues/${issueId}`;
}

function buildText(payload: WebhookPayload, config: WebhookConfig): string {
  if (payload.alert === "test") {
    return "【Myna】Webhook 测试消息\n这是一条测试通知，说明告警通道配置正常。";
  }

  const issue = payload.issue!;
  const link = issueLink(config, issue.id);
  const headline = payload.alert === "new" ? "新问题" : "问题复发";
  const lines = [
    `【Myna】${headline}`,
    `类型: ${issue.type}`,
    `消息: ${issue.title}`,
    `次数: ×${issue.count}`,
  ];
  if (issue.environment) lines.push(`环境: ${issue.environment}`);
  if (issue.release) lines.push(`版本: ${issue.release}`);
  if (link) lines.push(`查看: ${link}`);
  return lines.join("\n");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** DingTalk custom robot sign: https://open.dingtalk.com/document/robots/customize-robot-security-settings */
async function signDingTalk(secret: string, timestamp: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}\n${secret}`));
  return encodeURIComponent(bytesToBase64(new Uint8Array(mac)));
}

async function resolveRequestUrl(config: WebhookConfig): Promise<string> {
  const secret = config.signSecret.trim();
  if (!secret || resolveFormat(config.url) !== "dingtalk") return config.url;

  const timestamp = Date.now();
  const sign = await signDingTalk(secret, timestamp);
  const sep = config.url.includes("?") ? "&" : "?";
  return `${config.url}${sep}timestamp=${timestamp}&sign=${sign}`;
}

export function buildWebhookBody(
  config: WebhookConfig,
  payload: WebhookPayload,
): { headers: Record<string, string>; body: string } {
  const format = resolveFormat(config.url);
  const text = buildText(payload, config);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (format === "feishu") {
    return {
      headers,
      body: JSON.stringify({
        msg_type: "text",
        content: { text },
      }),
    };
  }

  if (format === "wecom" || format === "dingtalk") {
    return {
      headers,
      body: JSON.stringify({
        msgtype: "text",
        text: { content: text },
      }),
    };
  }

  const issue = payload.issue;
  return {
    headers,
    body: JSON.stringify({
      event: payload.alert === "test" ? "webhook.test" : `issue.${payload.alert}`,
      text,
      issue: issue
        ? {
            id: issue.id,
            title: issue.title,
            type: issue.type,
            count: issue.count,
            fingerprint: issue.fingerprint,
            environment: issue.environment,
            release: issue.release,
            url: issue.url,
          }
        : undefined,
      link: issue ? issueLink(config, issue.id) : null,
    }),
  };
}

export async function sendWebhook(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
  if (!config.enabled || !config.url) return;

  const { headers, body } = buildWebhookBody(config, payload);
  const url = await resolveRequestUrl(config);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Webhook 返回 ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
}

export function shouldNotify(config: WebhookConfig, alert: WebhookAlertKind): boolean {
  if (!config.enabled || !config.url) return false;
  if (alert === "new") return config.notifyNew;
  if (alert === "reopened") return config.notifyReopened;
  return false;
}

export async function dispatchIssueAlert(
  config: WebhookConfig,
  alert: WebhookAlertKind,
  issue: Issue,
): Promise<void> {
  if (!shouldNotify(config, alert)) return;
  await sendWebhook(config, { alert, issue, consoleUrl: config.consoleUrl });
}
