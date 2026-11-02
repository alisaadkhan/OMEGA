import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "../payments/signature";

/**
 * Outreach email providers (owner decision 2026-10-16). The mock records the request and delivers nothing; Resend
 * sends for real and is used only when OUTREACH_EMAIL_MODE=resend, which needs the owner's authorisation. Neither
 * adapter claims delivery: `accepted` means the provider took the message; delivery comes from signed webhooks.
 */
export type OutboundEmail = {
  /** Used as the provider idempotency key, so a retry of the same send is never sent twice. */
  sendId: string;
  from: string;
  /** Where replies go: the sending person's own address (never Roster's mailbox). */
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  /** One-click unsubscribe (RFC 8058 List-Unsubscribe headers). */
  unsubscribeUrl: string;
};
export type SendResult = { ok: true; messageId: string } | { ok: false; reason: string; retryable: boolean };

export interface EmailProvider {
  readonly mode: "test" | "resend";
  send(email: OutboundEmail): Promise<SendResult>;
}

/** Test mode: nothing leaves this machine. `sent` holds what would have been sent (for tests). */
export class MockEmailProvider implements EmailProvider {
  readonly mode = "test" as const;
  readonly sent: OutboundEmail[] = [];
  /** Lets a test make the provider refuse the next send. */
  failNext: string | null = null;

  async send(email: OutboundEmail): Promise<SendResult> {
    if (this.failNext) {
      const reason = this.failNext;
      this.failNext = null;
      return { ok: false, reason, retryable: false };
    }
    this.sent.push(email);
    return { ok: true, messageId: `mock_${randomUUID()}` };
  }
}

const RESEND_URL = "https://api.resend.com/emails";

/** Resend REST adapter. Not exercised against the real service until the owner configures and authorises it. */
export class ResendEmailProvider implements EmailProvider {
  readonly mode = "resend" as const;
  constructor(private readonly o: { apiKey: string; timeoutMs?: number; fetch?: typeof fetch }) {}

  async send(email: OutboundEmail): Promise<SendResult> {
    const doFetch = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json", "idempotency-key": email.sendId },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          ...(email.replyTo ? { reply_to: [email.replyTo] } : {}),
          subject: email.subject,
          text: email.text,
          headers: { "List-Unsubscribe": `<${email.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000),
      });
    } catch {
      return { ok: false, reason: "provider_unreachable", retryable: true };
    }
    const body = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
    if (res.ok && typeof body?.id === "string") return { ok: true, messageId: body.id };
    return { ok: false, reason: typeof body?.name === "string" ? body.name.slice(0, 80) : `http_${res.status}`, retryable: res.status === 429 || res.status >= 500 };
  }
}

// ── Webhooks (Resend signs with Svix: id.timestamp.body, HMAC-SHA256, base64 secret after "whsec_") ──────────────
export const EMAIL_WEBHOOK_TOLERANCE_SECONDS = 300;
type Headers = { id?: string; timestamp?: string; signature?: string };

const svixSignature = (secret: string, id: string, ts: string, body: string) =>
  createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

export function signEmailWebhook(secret: string, id: string, body: string, at: Date): Required<Headers> {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  return { id, timestamp, signature: `v1,${svixSignature(secret, id, timestamp, body)}` };
}

export function verifyEmailWebhook(h: Headers, body: string, secret: string, now: Date, toleranceSeconds = EMAIL_WEBHOOK_TOLERANCE_SECONDS): void {
  if (!h.id || !h.timestamp || !h.signature) throw new WebhookSignatureError("missing webhook signature headers");
  if (!/^\d{1,12}$/.test(h.timestamp)) throw new WebhookSignatureError("malformed webhook timestamp");
  if (Math.abs(now.getTime() / 1000 - Number(h.timestamp)) > toleranceSeconds) throw new WebhookSignatureError("stale webhook timestamp");
  const expected = Buffer.from(svixSignature(secret, h.id, h.timestamp, body), "base64");
  const ok = h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookSignatureError("webhook signature does not match");
}

export type EmailEvent = { messageId: string; status: "delivered" | "bounced" | "complained"; type: string } | { ignored: string };

/** The provider events that change a send's status; anything else (sent, opened, clicked, delayed) is ignored. */
export function parseEmailEvent(payload: unknown): EmailEvent {
  const p = payload as { type?: unknown; data?: { email_id?: unknown } } | null;
  const type = typeof p?.type === "string" ? p.type : "unknown";
  const messageId = typeof p?.data?.email_id === "string" ? p.data.email_id : null;
  const status = type === "email.delivered" ? "delivered" : type === "email.bounced" ? "bounced" : type === "email.complained" ? "complained" : null;
  if (!status || !messageId) return { ignored: type };
  return { messageId, status, type };
}
