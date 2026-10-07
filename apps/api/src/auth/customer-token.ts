import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AppError } from "@mushin/core";

export type CustomerIdentity = { userId: string; email: string; fullName: string | null };
export type CustomerTokenVerifier = (token: string) => Promise<CustomerIdentity>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function remoteJwks(uri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(uri));
}

export function createCustomerTokenVerifier(o: { issuer: string; audience: string; keys: JWTVerifyGetKey }): CustomerTokenVerifier {
  return async (token) => {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, o.keys, { issuer: o.issuer, audience: o.audience, algorithms: ["RS256", "ES256"] }));
    } catch (err) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired token", undefined, { cause: err });
    }
    const sub = payload["sub"];
    const email = payload["email"];
    if (typeof sub !== "string" || !UUID.test(sub) || typeof email !== "string" || !email.includes("@")) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired token");
    }
    const meta = payload["user_metadata"];
    const rawName = isRecord(meta) ? meta["full_name"] : undefined;
    const fullName = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 120) : null;
    return { userId: sub.toLowerCase(), email: email.toLowerCase(), fullName };
  };
}
