import type { StaffRole } from "./tokens";

/** Every staff action and the roles allowed to perform it. Anything not listed is denied. */
export const STAFF_PERMISSIONS = {
  "staff.me.read": ["admin", "support"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffAction = keyof typeof STAFF_PERMISSIONS;

export function can(role: StaffRole, action: string): boolean {
  const table: Record<string, readonly StaffRole[] | undefined> = STAFF_PERMISSIONS;
  // Own keys only: inherited names like "toString" or "__proto__" are not actions.
  if (!Object.hasOwn(table, action)) return false;
  return table[action]?.includes(role) ?? false;
}
