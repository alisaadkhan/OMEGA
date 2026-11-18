import { sql } from "drizzle-orm";

/**
 * Whether customers may see a creator row aliased `c` anywhere (search, lists, campaigns, exports, analytics): active,
 * and not a possible minor without a staff override. One definition, so a rule added here protects every path at once
 * (2026-11-15: five modules carried their own identical copy).
 */
export const CREATOR_VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;

/**
 * Customer catalogue and search (owner, 18 Nov): only creators with at least one email address that has not been shown
 * not to work. Hiding, never deleting: the record, its other contacts and every staff tool are unchanged, and the creator
 * returns once an email is found. Having an email does not make outreach allowed: plan, sender, suppression and sending
 * rules are checked when an email is sent (outreach). Reads only the contact's kind and status (no value), which the app
 * role may read under 0009/0032 grants. `c` is the creator row.
 */
export const HAS_USABLE_EMAIL = sql`exists (select 1 from gcp.creator_contacts k where k.creator_id = c.id and k.kind = 'email' and k.status <> 'invalid')`;

/** The same rule for a card row's contact states (kind and status only). */
export const hasUsableEmail = (states: readonly { kind: string; status: string }[]): boolean => states.some((k) => k.kind === "email" && k.status !== "invalid");
