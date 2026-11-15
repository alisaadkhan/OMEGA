import { sql } from "drizzle-orm";

/**
 * Whether customers may see a creator row aliased `c` anywhere (search, lists, campaigns, exports, analytics): active,
 * and not a possible minor without a staff override. One definition, so a rule added here protects every path at once
 * (2026-11-15: five modules carried their own identical copy).
 */
export const CREATOR_VISIBLE = sql`c.status = 'active' and not (c.is_minor and c.minor_override_by_staff_id is null)`;
