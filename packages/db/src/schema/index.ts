import { users, workspaceMembers, workspaces } from "./identity";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./identity";
export * from "./staff";

export const ALL_TABLES = [users, workspaces, workspaceMembers, staffUsers, staffSessions, auditLog];
