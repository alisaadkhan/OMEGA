import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;

const hmac = (secret: string, ts: number, rawBody: string) => createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");

/** Paddle's scheme: `ts=<unix seconds>;h1=<hex HMAC-SHA256(secret, ts + ":" + rawBody)>`. */
export function signPaddleWebhook(secret: string, rawBody: string, at: Date): string {
  const ts = Math.floor(at.getTime() / 1000);
  return `ts=${ts};h1=${hmac(secret, ts, rawBody)}`;
}

export function verifyPaddleSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  now: Date,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): void {
  if (!header) throw new WebhookSignatureError("missing Paddle-Signature header");
  let ts: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "ts" && value && /^\d{1,12}$/.test(value)) ts = Number(value);
    else if (key === "h1" && value && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (ts === null || signatures.length === 0) throw new WebhookSignatureError("malformed Paddle-Signature header");
  if (Math.abs(now.getTime() / 1000 - ts) > toleranceSeconds) throw new WebhookSignatureError("stale webhook timestamp");
  const expected = Buffer.from(hmac(secret, ts, rawBody), "hex");
  const ok = signatures.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookSignatureError("signature mismatch");
}
