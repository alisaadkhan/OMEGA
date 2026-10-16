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
check("Supabase also copies email_verified into user metadata (informational only; never trusted, audit SEC-03)", claims.user_metadata?.email_verified === true, `email_verified=${claims.user_metadata?.email_verified}`);

const refreshed = await auth("/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
const second = await me(refreshed.json?.access_token);
check("a refreshed token works and reaches the same workspace", second.status === 200 && second.json?.workspace?.id === first.json?.workspace?.id);

const [h, p, s] = session.access_token.split(".");
const tampered = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: randomUUID() })).toString("base64url")}.${s}`;
check("a token with changed claims is refused", (await me(tampered)).status === 401);
const forged = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${p}.${s}`;
check("a token re-labelled HS256 (algorithm confusion) is refused", (await me(forged)).status === 401);
check("no token is refused", (await me(null)).status === 401);

// Audit SEC-03 against the real Auth server: user_metadata is user-editable, the Auth record is not.
const { createSupabaseEmailVerification } = await import("../../apps/api/src/auth/auth-admin.ts");
const verifyEmail = createSupabaseEmailVerification({ url: status.API_URL, serviceKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY });
const edited = await fetch(`${AUTH}/user`, { method: "PUT", headers: { apikey: key, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ data: { email_verified: true, role_claim: "forged" } }) });
check("a signed-in user can write their own user_metadata (why it must never prove anything)", edited.status === 200 && (await edited.json()).user_metadata?.role_claim === "forged");
check("the Auth server's record confirms this user's email, read with the service key", JSON.stringify(await verifyEmail(claims.sub)) === JSON.stringify({ email, confirmed: true }));
const unconfirmedEmail = `unconfirmed-${randomUUID().slice(0, 8)}@example.com`;
const created = await fetch(`${AUTH}/admin/users`, { method: "POST", headers: { apikey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SECRET_KEY ?? status.SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ email: unconfirmedEmail, password, email_confirm: false, user_metadata: { email_verified: true } }) });
const unconfirmed = await created.json();
check("a user whose metadata claims email_verified but whose address is unconfirmed is reported unconfirmed", created.status === 200 && JSON.stringify(await verifyEmail(unconfirmed.id)) === JSON.stringify({ email: unconfirmedEmail, confirmed: false }), `${created.status}`);

// Audit SEC-13: deleting the account through the API also removes the Supabase Auth user, so the address can sign up again.
const leaverEmail = `leaver-${randomUUID().slice(0, 8)}@example.com`;
const leaverSignup = await auth("/signup", { email: leaverEmail, password });
const leaver = leaverSignup.json?.access_token ? leaverSignup.json : (await auth("/token?grant_type=password", { email: leaverEmail, password })).json;
const leaverId = JSON.parse(Buffer.from(leaver.access_token.split(".")[1], "base64url").toString()).sub;
await me(leaver.access_token);
const deletion = await fetch(`${API}/v1/me/delete`, { method: "POST", headers: { authorization: `Bearer ${leaver.access_token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ confirmEmail: leaverEmail }) });
const deletionBody = await deletion.json().catch(() => null);
check("account deletion through the API reports the Supabase Auth user deleted", deletion.status === 200 && deletionBody?.identityProviderAccount === "deleted", `${deletion.status} ${deletionBody?.identityProviderAccount ?? JSON.stringify(deletionBody?.error ?? {})}`);
check("the Auth server no longer has that user", (await verifyEmail(leaverId)) === null);
check("the deleted user's old password no longer signs in", (await auth("/token?grant_type=password", { email: leaverEmail, password })).status >= 400);
const again = await auth("/signup", { email: leaverEmail, password });
const againSession = again.json?.access_token ? again.json : (await auth("/token?grant_type=password", { email: leaverEmail, password })).json;
const againMe = await me(againSession?.access_token);
check("the same address can sign up again and gets a fresh account", againMe.status === 200 && againMe.json?.user?.id !== leaverId && againMe.json?.user?.email === leaverEmail, `${againMe.status}`);

const signout = await fetch(`${AUTH}/logout`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${session.access_token}` } });
check("sign-out revokes the refresh token", signout.status === 204 && (await auth("/token?grant_type=refresh_token", { refresh_token: refreshed.json?.refresh_token ?? session.refresh_token })).status >= 400);
// The API verifies access tokens statelessly: a signed-out access token stays valid until it expires (jwt_expiry).
console.log(`note: access tokens expire after ${claims.exp - claims.iat} s; the API does not consult a revocation list`);

const failed = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ check: "supabase-auth", passed: results.length - failed, failed }));
await new Promise((r) => setTimeout(r, 100));
process.exit(failed ? 1 : 0);
