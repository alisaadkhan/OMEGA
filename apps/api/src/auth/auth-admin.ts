/**
 * Trusted email verification (audit SEC-03). Supabase puts `user_metadata` in the access token, and users can edit it
 * themselves, so `user_metadata.email_verified` proves nothing. The Auth server's own record (`email_confirmed_at`,
 * read with the service key) is the evidence. Used where it matters: accepting a workspace invitation.
 */
export type VerifiedEmail = { email: string; confirmed: boolean };
/** null: the user does not exist in the identity provider. Throws when the check could not be made (fail closed). */
export type VerifyEmail = (userId: string) => Promise<VerifiedEmail | null>;

export class EmailCheckUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailCheckUnavailable";
  }
}

export function createSupabaseEmailVerification(o: { url: string; serviceKey: string; timeoutMs?: number; fetch?: typeof fetch }): VerifyEmail {
  const base = o.url.replace(/\/+$/, "");
  return async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    let res: Response;
    try {
      res = await (o.fetch ?? fetch)(`${base}/auth/v1/admin/users/${userId}`, {
        headers: { apikey: o.serviceKey, authorization: `Bearer ${o.serviceKey}` },
        signal: AbortSignal.timeout(o.timeoutMs ?? 5_000),
      });
    } catch {
      throw new EmailCheckUnavailable("The sign-in service could not be reached to check the email address.");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new EmailCheckUnavailable(`The sign-in service refused the email check (${res.status}).`);
    const body = (await res.json().catch(() => null)) as { email?: unknown; email_confirmed_at?: unknown } | null;
    if (typeof body?.email !== "string") return null;
    return { email: body.email.toLowerCase(), confirmed: typeof body.email_confirmed_at === "string" && body.email_confirmed_at.length > 0 };
  };
}

/**
 * Removes the person from Supabase Auth (audit SEC-13), so a deleted account leaves no sign-in identity behind and the
 * email address can be used again. Resolves true when the user is gone (also when it was already gone), false when the
 * Auth server could not be reached or refused; it never throws, because the database deletion has already happened.
 */
export type DeleteIdentity = (userId: string) => Promise<boolean>;

export function createSupabaseIdentityDeletion(o: { url: string; serviceKey: string; timeoutMs?: number; fetch?: typeof fetch }): DeleteIdentity {
  const base = o.url.replace(/\/+$/, "");
  return async (userId) => {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
    try {
      const res = await (o.fetch ?? fetch)(`${base}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: { apikey: o.serviceKey, authorization: `Bearer ${o.serviceKey}` },
        signal: AbortSignal.timeout(o.timeoutMs ?? 5_000),
      });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  };
}
