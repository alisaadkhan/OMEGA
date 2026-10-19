import { useMutation } from "@tanstack/react-query";
import { trialReceivedSchema, type TrialFeedbackCreate } from "@mushin/contracts";
import { apiRequest } from "./client";

/** Trial dates are shown with time and zone: the trial ends at that exact moment on the server, not at midnight. */
export function formatTrialDate(iso: string): string {
  return `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })} PKT`;
}

export function useSendTrialFeedback() {
  return useMutation({ mutationFn: (body: TrialFeedbackCreate) => apiRequest("/v1/trial-feedback", trialReceivedSchema, { method: "POST", body }) });
}
