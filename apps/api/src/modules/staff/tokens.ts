import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { AppError } from "@mushin/core";

export type StaffRole = "admin" | "support";
/** Second factors proven at sign-in: "otp" (TOTP) today; "hwk" (WebAuthn hardware key) once that sign-in exists. */
export type StaffFactor = "otp" | "hwk";
export type StaffPrincipal = { staffId: string; role: StaffRole; factors: StaffFactor[] };

const ISSUER = "mushin-staff";
const AUDIENCE = "mushin-admin";
export const ACCESS_TTL_SECONDS = 15 * 60;
export const CHALLENGE_TTL_SECONDS = 5 * 60;

type TokenType = "access" | "totp_challenge";

export function createStaffTokens(secret: string, now: () => Date = () => new Date()) {
  const key = new TextEncoder().encode(secret);

  function sign(claims: Record<string, unknown>, subject: string, ttlSeconds: number): Promise<string> {
    const issuedAt = Math.floor(now().getTime() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttlSeconds)
      .sign(key);
  }

  async function verify(token: string, typ: TokenType): Promise<JWTPayload & { sub: string }> {
    const invalid = () => new AppError("UNAUTHENTICATED", "Invalid or expired staff token");
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"], currentDate: now() }));
    } catch (err) {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired staff token", undefined, { cause: err });
    }
    if (payload["typ"] !== typ || typeof payload.sub !== "string") throw invalid();
    return { ...payload, sub: payload.sub };
  }

  return {
    signAccess: (p: Omit<StaffPrincipal, "factors"> & { factors?: StaffFactor[] }) => sign({ typ: "access", role: p.role, amr: p.factors ?? ["otp"] }, p.staffId, ACCESS_TTL_SECONDS),
    signChallenge: (staffId: string) => sign({ typ: "totp_challenge" }, staffId, CHALLENGE_TTL_SECONDS),
    async verifyAccess(token: string): Promise<StaffPrincipal> {
      const p = await verify(token, "access");
      const role = p["role"];
      if (role !== "admin" && role !== "support") throw new AppError("UNAUTHENTICATED", "Invalid or expired staff token");
      const amr = Array.isArray(p["amr"]) ? (p["amr"] as unknown[]) : [];
      const factors = amr.filter((f): f is StaffFactor => f === "otp" || f === "hwk");
      return { staffId: p.sub, role, factors };
    },
    async verifyChallenge(token: string): Promise<string> {
      return (await verify(token, "totp_challenge")).sub;
    },
  };
}

export type StaffTokens = ReturnType<typeof createStaffTokens>;
