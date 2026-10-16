/**
 * The workspace this tab works in (audit SEC-04). Kept per tab (sessionStorage), so switching in one tab never moves
 * another tab's requests. The API refuses a workspace the person no longer belongs to (403 workspace_access_denied)
 * instead of using another one; the client then forgets the selection and tells the person.
 */
const KEY = "mushin.workspace";
const NOTICE = "mushin.workspace.notice";

export function selectedWorkspace(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function selectWorkspace(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private window): the default workspace is used.
  }
}

/** The selected workspace is no longer accessible: forget it and leave a notice for the next screen. */
export function dropInaccessibleWorkspace(): void {
  selectWorkspace(null);
  try {
    sessionStorage.setItem(NOTICE, "You no longer have access to the workspace you were working in. You are now in your own workspace.");
  } catch {
    // The reload still lands in the default workspace.
  }
}

/** Shown once after a refused workspace (see dropInaccessibleWorkspace). */
export function takeWorkspaceNotice(): string | null {
  try {
    const n = sessionStorage.getItem(NOTICE);
    if (n) sessionStorage.removeItem(NOTICE);
    return n;
  } catch {
    return null;
  }
}
