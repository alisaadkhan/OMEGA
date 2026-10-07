import { users, workspaceMembers, workspaces } from "./identity";

export * from "./identity";

/** Every Drizzle table; the drift test compares each one with the live database. */
export const ALL_TABLES = [users, workspaces, workspaceMembers];
