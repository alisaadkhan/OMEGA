/* global process, console -- Node script */
// Sign-in stub for the staff/team E2E: JWKS on :4998 and ES256 tokens in Supabase's claim shape (with
// user_metadata.email_verified), written to <E2E_STAFF_OUT>/identities.json. Real Supabase sign-in is not exercised.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as jose from "jose";
const { publicKey, privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await jose.exportJWK(publicKey)), kid: "team", alg: "ES256", use: "sig" };
const issuer = "http://localhost:4998/auth/v1";
const people = {
  owner: { sub: "a1111111-1111-4111-8111-111111111111", email: "olivia@team.test", name: "Olivia Owner", verified: true },
  invitee: { sub: "a2222222-2222-4222-8222-222222222222", email: "sara@team.test", name: "Sara Invitee", verified: true },
  stranger: { sub: "a3333333-3333-4333-8333-333333333333", email: "mallory@team.test", name: "Mallory Stranger", verified: true },
};
const exp = Math.floor(Date.now() / 1000) + 10 * 3600;
const out = {};
for (const [role, p] of Object.entries(people)) {
  const token = await new jose.SignJWT({ email: p.email, role: "authenticated", user_metadata: { full_name: p.name, email_verified: p.verified } })
    .setProtectedHeader({ alg: "ES256", kid: "team" }).setIssuer(issuer).setAudience("authenticated").setSubject(p.sub).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  out[role] = { ...p, token, exp };
}
const dir = process.env.E2E_STAFF_OUT ?? join(tmpdir(), "mushin-e2e-staff");
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
}).listen(4998, "127.0.0.1", () => console.log("staff e2e auth stub ready"));
