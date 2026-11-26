import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { markNotificationsReadResultSchema, notificationListSchema } from "@mushin/contracts";
import { apiRequest } from "./client";
import { useAuth } from "../auth/AuthContext";

/** The person's notifications, shared by the bell and the sidebar badges (one request, refreshed every minute). */
export function useNotifications() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiRequest("/v1/notifications", notificationListSchema),
    enabled: status === "signedIn",
    refetchInterval: 60_000,
  });
}

/** Mark notifications read: some by id (the bell), every one of a page (opening it), or all. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target?: { ids: string[] } | { view: string }) =>
      apiRequest("/v1/notifications/read", markNotificationsReadResultSchema, { method: "POST", body: target ?? {} }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
