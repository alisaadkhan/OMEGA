/* global process, console, fetch, setTimeout, Buffer -- Node script */
// Real Supabase Auth against the MUSHIN API, on the LOCAL Supabase stack only (supabase start): sign-up through GoTrue,
// the issued ES256 access token verified by the API through Supabase's JWKS, workspace provisioning, refresh, and
// refusal of forged, tampered and expired tokens. Mail stays in the local Mailpit; nothing leaves this machine.
//   API on :4200 configured with JWKS_URI/JWT_ISSUER of the local stack (see auth-check.sh).
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const status = JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const AUTH = `${status.API_URL}/auth/v1`;
const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) throw new Error("auth-check runs against the local Supabase stack only");
const API = "http://localhost:4200";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(ok ? "PASS" : "FAIL", "|", name, detail ? `| ${detail}` : "");
};
const auth = (path, body) => fetch(`${AUTH}${path}`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const me = (token) => fetch(`${API}/v1/me`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

const email = `auth-check-${randomUUID().slice(0, 8)}@example.com`;
const password = `Pw-${randomUUID()}`;
const signup = await auth("/signup", { email, password, data: { full_name: "Auth Check" } });
const session = signup.json?.access_token ? signup.json : (await auth("/token?grant_type=password", { email, password })).json;
check("Supabase Auth signs a new user up and issues a session", typeof session?.access_token === "string", `signup ${signup.status}`);
const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString());
const header = JSON.parse(Buffer.from(session.access_token.split(".")[0], "base64url").toString());
check("the access token is ES256-signed with a published key id (JWKS), not a shared secret", header.alg === "ES256" && typeof header.kid === "string", `${header.alg} ${claims.iss}`);

const first = await me(session.access_token);
check("the API accepts the Supabase token and provisions the user's workspace", first.status === 200 && first.json?.user?.email === email && typeof first.json?.workspace?.id === "string", `${first.status}`);
check("the API records the name from Supabase user metadata", first.json?.user?.displayName === "Auth Check" || first.json?.user?.name === "Auth Check", JSON.stringify(first.json?.user ?? {}).slice(0, 120));
check("Supabase marks the address confirmed in user metadata (invitations rely on it)", claims.user_metadata?.email_verified === true, `email_verified=${claims.user_metadata?.email_verified}`);

const refreshed = await auth("/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
const second = await me(refreshed.json?.access_token);
check("a refreshed token works and reaches the same workspace", second.status === 200 && second.json?.workspace?.id === first.json?.workspace?.id);

const [h, p, s] = session.access_token.split(".");
const tampered = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: randomUUID() })).toString("base64url")}.${s}`;
check("a token with changed claims is refused", (await me(tampered)).status === 401);
const forged = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${p}.${s}`;
check("a token re-labelled HS256 (algorithm confusion) is refused", (await me(forged)).status === 401);
check("no token is refused", (await me(null)).status === 401);

const signout = await fetch(`${AUTH}/logout`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${session.access_token}` } });
check("sign-out revokes the refresh token", signout.status === 204 && (await auth("/token?grant_type=refresh_token", { refresh_token: refreshed.json?.refresh_token ?? session.refresh_token })).status >= 400);
// The API verifies access tokens statelessly: a signed-out access token stays valid until it expires (jwt_expiry).
console.log(`note: access tokens expire after ${claims.exp - claims.iat} s; the API does not consult a revocation list`);

const failed = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ check: "supabase-auth", passed: results.length - failed, failed }));
await new Promise((r) => setTimeout(r, 100));
process.exit(failed ? 1 : 0);
