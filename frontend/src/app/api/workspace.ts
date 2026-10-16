/**
 * The workspace this browser works in (a per-viewer convenience). The API honours it only for workspaces the person
 * belongs to and otherwise uses their oldest membership, so a stale or tampered value can never open another workspace.
 */
const KEY = "mushin.workspace";

export function selectedWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function selectWorkspace(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private window): the default workspace is used.
  }
}
