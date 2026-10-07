export type WorkspaceRole = "owner" | "admin" | "member";

export type TenantContext = {
  requestId: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
};
