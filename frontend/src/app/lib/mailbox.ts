import { useSyncExternalStore } from "react";

export type MailboxProvider = "gmail" | "outlook" | null;
export type MailboxState = { provider: MailboxProvider; address: string };

let state: MailboxState = { provider: "gmail", address: "marketing@brand.pk" };
const listeners = new Set<() => void>();

export const getMailbox = () => state;

export function setMailbox(next: MailboxState) {
  state = next;
  listeners.forEach((l) => l());
}

export const providerLabel = (p: MailboxProvider) => (p === "gmail" ? "Gmail" : p === "outlook" ? "Outlook" : "");

export function useMailbox() {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getMailbox);
}
