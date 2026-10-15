import { z } from "zod";
import { staffSecuritySchema, staffSessionResponseSchema, webauthnOptionsResponseSchema } from "@mushin/contracts";
import { adminRequest, setAdminToken } from "./adminApi";

/**
 * Browser side of the staff hardware-key ceremonies. The server's options (standard WebAuthn JSON) become the binary
 * structures `navigator.credentials` expects, and the key's answer goes back as standard JSON; the server verifies it.
 */
const fromB64u = (s: string): ArrayBuffer => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out.buffer;
};
const toB64u = (buf: ArrayBuffer): string => {
  let s = "";
  for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

type Desc = { id: string; type?: string; transports?: string[] };
const descriptors = (list: unknown) => ((list as Desc[] | undefined) ?? []).map((d) => ({ id: fromB64u(d.id), type: "public-key" as const, ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}) }));

export const webauthnSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;

/** A user-facing message for the ways a browser ceremony ends without a key answer. */
export function keyErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "The security key request was cancelled or timed out.";
    if (err.name === "InvalidStateError") return "This security key is already registered.";
    if (err.name === "SecurityError") return "Security keys work only on the MUSHIN site itself.";
  }
  return err instanceof Error ? err.message : "The security key could not be used.";
}

export async function registerKey(nickname: string): Promise<void> {
  const { options: o } = await adminRequest("/admin/v1/security/keys/options", webauthnOptionsResponseSchema, { method: "POST" });
  const rp = o["rp"] as { id: string; name: string };
  const user = o["user"] as { id: string; name: string; displayName: string };
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(o["challenge"] as string),
      rp,
      user: { id: fromB64u(user.id), name: user.name, displayName: user.displayName },
      pubKeyCredParams: o["pubKeyCredParams"] as PublicKeyCredentialParameters[],
      timeout: o["timeout"] as number | undefined,
      attestation: "none",
      excludeCredentials: descriptors(o["excludeCredentials"]),
      authenticatorSelection: o["authenticatorSelection"] as AuthenticatorSelectionCriteria,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No security key answered.");
  const r = cred.response as AuthenticatorAttestationResponse;
  const response = {
    id: cred.id,
    rawId: toB64u(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject), transports: typeof r.getTransports === "function" ? r.getTransports() : [] },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
  await adminRequest("/admin/v1/security/keys", z.object({ id: z.uuid() }), { method: "POST", body: { response, nickname } });
}

/** Proves the key for this session; the returned access token carries the hardware-key factor for 15 minutes. */
export async function stepUp(): Promise<void> {
  const { options: o } = await adminRequest("/admin/v1/security/step-up/options", webauthnOptionsResponseSchema, { method: "POST" });
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: fromB64u(o["challenge"] as string), rpId: o["rpId"] as string, allowCredentials: descriptors(o["allowCredentials"]), userVerification: "required", timeout: o["timeout"] as number | undefined },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No security key answered.");
  const r = cred.response as AuthenticatorAssertionResponse;
  const response = {
    id: cred.id,
    rawId: toB64u(cred.rawId),
    type: cred.type,
    response: { clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature), ...(r.userHandle ? { userHandle: toB64u(r.userHandle) } : {}) },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
  const session = await adminRequest("/admin/v1/security/step-up", staffSessionResponseSchema, { method: "POST", body: { response } });
  setAdminToken(session.accessToken);
}

export const securityState = () => adminRequest("/admin/v1/security", staffSecuritySchema);
