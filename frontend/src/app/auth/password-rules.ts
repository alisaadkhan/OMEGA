/**
 * Password rules shown to people (owner, 17 Nov): the usual "8 characters with a number, a symbol and both cases"
 * checklist instead of the Auth server's raw character list. The hosted Auth policy requires a lower-case letter, an
 * upper-case letter, a digit and one of its symbols; these rules match it, so a password that passes here is accepted.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** The Auth server's symbol set. A space or an accented letter does not count as a special character there. */
const SPECIAL = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

export const PASSWORD_RULES: ReadonlyArray<{ id: string; label: string; ok: (pw: string) => boolean }> = [
  { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: (pw) => pw.length >= PASSWORD_MIN_LENGTH },
  { id: "upper", label: "An uppercase letter", ok: (pw) => /[A-Z]/.test(pw) },
  { id: "lower", label: "A lowercase letter", ok: (pw) => /[a-z]/.test(pw) },
  { id: "number", label: "A number", ok: (pw) => /\d/.test(pw) },
  { id: "special", label: "A special character, like ! @ # ?", ok: (pw) => SPECIAL.test(pw) },
];

export const passwordMeetsRules = (pw: string) => PASSWORD_RULES.every((r) => r.ok(pw));

export const PASSWORD_HINT = `Use at least ${PASSWORD_MIN_LENGTH} characters, with an uppercase and a lowercase letter, a number and a special character.`;

/** The Auth server's password complaints, in plain words; null when the error is about something else. */
export function friendlyPasswordError(error: { message?: string; code?: string } | null | undefined): string | null {
  if (!error) return null;
  if (error.code === "weak_password") return PASSWORD_HINT;
  if (/password should (contain|be at least)|password is too (weak|short)|weak password/i.test(error.message ?? "")) return PASSWORD_HINT;
  return null;
}
