import type { StaffRole } from "./tokens";

/** Every staff action and the roles allowed to perform it. Anything not listed is denied. */
export const STAFF_PERMISSIONS = {
  "staff.me.read": ["admin", "support"],
  "creators.removal.review": ["admin"],
  // Operations views (canonical spec pages 20–23): support staff get the redacted minimum; admins also see provider
  // usage and the audit history. There is no super-admin role and no credit, impersonation or export action.
  "ops.overview.read": ["admin", "support"],
  "ops.jobs.read": ["admin", "support"],
  "ops.workspaces.read": ["admin", "support"],
  "ops.providers.read": ["admin"],
  "support.tickets.read": ["admin", "support"],
  "support.tickets.reply": ["admin", "support"],
  "staff.audit.read": ["admin"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffAction = keyof typeof STAFF_PERMISSIONS;

export function can(role: StaffRole, action: string): boolean {
  const table: Record<string, readonly StaffRole[] | undefined> = STAFF_PERMISSIONS;
  // Own keys only: inherited names like "toString" or "__proto__" are not actions.
  if (!Object.hasOwn(table, action)) return false;
  return table[action]?.includes(role) ?? false;
}
