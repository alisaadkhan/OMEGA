import { LEGAL_VERSION } from "@mushin/contracts";

/**
 * Audit UX-01. The sign-up form has no session yet, so the version the person ticked is kept for this tab and recorded
 * with the API on the first signed-in screen. Without it (another tab, another device) the app asks again.
 */
const KEY = "mushin.legal.accepted";

export function rememberLegalAcceptance(): void {
  try {
    sessionStorage.setItem(KEY, LEGAL_VERSION);
  } catch {
    // The dashboard will ask instead.
  }
}

export function takeRememberedAcceptance(): boolean {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v === LEGAL_VERSION;
  } catch {
    return false;
  }
}
