/* global process, console -- Node script */
// Local-only sign-in stub for customer E2E: one JWKS on :4999 and ES256 tokens (Supabase claim shape) for fixed test
// identities, written to ./identities.json. Real Supabase sign-in is not exercised by this stub.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as jose from "jose";
const { publicKey, privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await jose.exportJWK(publicKey)), kid: "e2e", alg: "ES256", use: "sig" };
const issuer = "http://localhost:4999/auth/v1";
const people = {
  owner: { sub: "11111111-1111-4111-8111-111111111111", email: "owner@e2e.test", name: "Olivia Owner" },
  admin: { sub: "22222222-2222-4222-8222-222222222222", email: "admin@e2e.test", name: "Adam Admin" },
  member: { sub: "33333333-3333-4333-8333-333333333333", email: "member@e2e.test", name: "Mona Member" },
  outsider: { sub: "44444444-4444-4444-8444-444444444444", email: "outsider@e2e.test", name: "Omar Outsider" },
  expired: { sub: "55555555-5555-4555-8555-555555555555", email: "expired@e2e.test", name: "Ed Expired" },
  // Joins the owner's workspace through a real invitation link (team journey).
  invitee: { sub: "66666666-6666-4666-8666-666666666666", email: "invitee@e2e.test", name: "Ivy Invitee" },
};
const exp = Math.floor(Date.now() / 1000) + 10 * 3600;
const out = {};
for (const [role, p] of Object.entries(people)) {
  const tokenExp = role === "expired" ? Math.floor(Date.now() / 1000) - 60 : exp;
  const token = await new jose.SignJWT({ email: p.email, role: "authenticated", user_metadata: { full_name: p.name, email_verified: true } })
    .setProtectedHeader({ alg: "ES256", kid: "e2e" }).setIssuer(issuer).setAudience("authenticated").setSubject(p.sub).setIssuedAt().setExpirationTime(tokenExp).sign(privateKey);
  out[role] = { ...p, token, exp: tokenExp };
}
const dir = process.env.E2E_OUT ?? join(tmpdir(), "mushin-e2e");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "identities.json"), JSON.stringify(out));
createServer((req, res) => {
  if (req.url === "/jwks.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(4999, "127.0.0.1", () => console.log("e2e auth stub ready"));
