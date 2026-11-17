import { useQuery } from "@tanstack/react-query";
import { activityFeedSchema } from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";

/** The newest workspace activity (bell and dashboard); refreshed every minute while signed in. */
export function useRecentActivity(limit = 20) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["activity", "recent", limit],
    queryFn: () => apiRequest(`/v1/activity?limit=${limit}`, activityFeedSchema),
    enabled: status === "signedIn",
    refetchInterval: 60_000,
  });
}
