import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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

/** The full feed, paged by time ("Load older"). */
export function useActivityFeed() {
  const { status } = useAuth();
  return useInfiniteQuery({
    queryKey: ["activity", "feed"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiRequest(`/v1/activity?limit=30${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`, activityFeedSchema),
    getNextPageParam: (last) => (last.events.length === 30 ? (last.events[last.events.length - 1]?.at ?? null) : null),
    enabled: status === "signedIn",
  });
}
