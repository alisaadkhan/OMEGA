import type { StaffRole } from "./tokens";

const ALL = ["support", "admin", "super_admin"] as const;
const ADMIN = ["admin", "super_admin"] as const;
const SUPER = ["super_admin"] as const;

/**
 * Every staff action and the roles allowed to perform it (staff spec §1–3). Anything not listed is denied. Support is the
 * base role; Admin (operations) adds job, provider, privacy and reconciliation actions; Super Admin (platform owners
 * only) adds staff administration and the co-sign approvals. Customer workspace roles never grant any of these.
 */
export const STAFF_PERMISSIONS = {
  "staff.me.read": ALL,
  "staff.security.read": ALL,
  // Support: tickets, redacted lookups, read-only diagnostics and consented, read-only workspace access.
  "ops.overview.read": ALL,
  "ops.alerts.read": ALL,
  "ops.jobs.read": ALL,
  "ops.workspaces.read": ALL,
  "support.tickets.read": ALL,
  "support.tickets.reply": ALL,
  "support.tickets.note": ALL,
  "support.tickets.assign_self": ALL,
  "support.access.request": ALL,
  "support.access.view": ALL,
  // Founder-assisted trial: everyone sees the callback queue and records a call back (0050).
  "trials.read": ALL,
  "trials.contact": ALL,
  // Catalogue review queue (owner directive 2026-11-03): everyone can look; deciding a country or a minor flag is Admin.
  "catalogue.review.read": ALL,
  // Admin (operations) and above. These require a hardware-key step-up (HARDWARE_KEY_ACTIONS).
  "staff.webauthn.manage": ADMIN,
  "creators.removal.review": ADMIN,
  "ops.providers.read": ADMIN,
  "ops.alerts.test": ADMIN,
  "ops.providers.control": ADMIN,
  "ops.jobs.retry": ADMIN,
  "ops.jobs.cancel": ADMIN,
  "support.tickets.assign": ADMIN,
  "catalogue.review.decide": ADMIN,
  "staff.audit.read": ADMIN,
  "staff.list": ADMIN,
  "approvals.read": ADMIN,
  "approvals.request": ADMIN,
  "approvals.decide": ADMIN,
  // Product reviews and usage analytics (plan Phase 12, 2026-10-29): Staff Admin and Super Admin.
  "feedback.read": ADMIN,
  "feedback.review": ADMIN,
  "analytics.read": ADMIN,
  // Super Admin only.
  // Staff performance oversight (plan Phase 11).
  "support.performance.read": SUPER,
  "staff.manage": SUPER,
  // Owner decision 2026-10-19: only the platform owners approve, reject or look up trials, and read trial feedback.
  "trials.decide": SUPER,
  "trials.feedback.read": SUPER,
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffAction = keyof typeof STAFF_PERMISSIONS;

/**
 * Admin and Super Admin actions need a WebAuthn hardware-key step-up in the current session (master pack DOC-029:
 * Support TOTP mandatory, Admin hardware key mandatory). TOTP alone is never treated as hardware-key compliance. The
 * exceptions are the enrolment itself on a TOTP session when no key is registered yet (handled in the WebAuthn
 * routes) and reading one's own security state.
 */
export const HARDWARE_KEY_ACTIONS: ReadonlySet<StaffAction> = new Set(
  (Object.keys(STAFF_PERMISSIONS) as StaffAction[]).filter((a) => !(STAFF_PERMISSIONS[a] as readonly string[]).includes("support") && a !== "staff.webauthn.manage"),
);

/**
 * High-impact actions that need a second person (staff spec §2), who may request them, and whether the approver must be
 * a Super Admin (co-sign). The requester never approves their own request, except a Super Admin's own credit grant (0071). Not offered because nothing can execute
 * them yet: provider cap changes (caps are deployment configuration) and suspending a customer workspace (no
 * workspace status exists); the database lists them so they can be added without a schema change.
 */
export const APPROVAL_RULES = {
  "credits.grant": { request: ADMIN, superAdminCosign: false },
  "staff.role.change": { request: SUPER, superAdminCosign: true },
  "staff.suspend": { request: SUPER, superAdminCosign: true },
} as const satisfies Record<string, { request: readonly StaffRole[]; superAdminCosign: boolean }>;
export type ApprovalAction = keyof typeof APPROVAL_RULES;

export function can(role: StaffRole, action: string): boolean {
  const table: Record<string, readonly StaffRole[] | undefined> = STAFF_PERMISSIONS;
  // Own keys only: inherited names like "toString" or "__proto__" are not actions.
  if (!Object.hasOwn(table, action)) return false;
  return table[action]?.includes(role) ?? false;
}
