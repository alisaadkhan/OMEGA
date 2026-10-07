import { users, workspaceMembers, workspaces } from "./identity";
import { idempotencyKeys, outbox, providerCalls } from "./platform";
import { auditLog, staffSessions, staffUsers } from "./staff";

export * from "./identity";
export * from "./platform";
export * from "./staff";

export const ALL_TABLES = [users, workspaces, workspaceMembers, staffUsers, staffSessions, auditLog, outbox, providerCalls, idempotencyKeys];
