import { randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from "jose";

export type TestClaims = {
  sub?: string;
  email?: string | null;
  fullName?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
};

export async function createTestIssuer() {
  const issuer = "https://test-project.supabase.co/auth/v1";
  const audience = "authenticated";
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "test-key";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  const keys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });

  async function sign(claims: TestClaims = {}): Promise<string> {
    const body: Record<string, unknown> = { role: "authenticated" };
    if (claims.email !== null) body["email"] = claims.email ?? "ahmed@mushin.pk";
    if (claims.fullName) body["user_metadata"] = { full_name: claims.fullName };
    return new SignJWT(body)
      .setProtectedHeader({ alg: "ES256", kid })
      .setSubject(claims.sub ?? randomUUID())
      .setIssuer(claims.issuer ?? issuer)
      .setAudience(claims.audience ?? audience)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? "15m")
      .sign(privateKey);
  }

  return { issuer, audience, keys, sign };
}
