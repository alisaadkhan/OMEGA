import { sql } from "drizzle-orm";

/**
 * Whether customers may see a creator row aliased `c` anywhere (search, lists, campaigns, exports, analytics): active,
 * and not a possible minor without a staff override. One definition, so a rule added here protects every path at once
 * (2026-11-15: five modules carried their own identical copy).
 */
export const CREATOR_VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;

/**
 * A creator with at least one email not shown to be invalid, from a card row's contact states (kind and status only, no
 * value). Customer search ranks these first (owner, 22 Nov). Having an email does not make outreach allowed: plan,
 * sender, suppression and sending rules are checked when an email is sent.
 */
export const hasUsableEmail = (states: readonly { kind: string; status: string }[]): boolean => states.some((k) => k.kind === "email" && k.status !== "invalid");
/** The same for a phone number. */
export const hasUsablePhone = (states: readonly { kind: string; status: string }[]): boolean => states.some((k) => k.kind === "phone" && k.status !== "invalid");
