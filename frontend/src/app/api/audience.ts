import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { audienceStateSchema } from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";
import { isAudienceRunning } from "./audience-mapping";

/** Reading the audience state is free: it never computes or charges anything. Polls every 2 s while an estimate runs. */
export function useAudience(creatorId: string | null) {
  const { status } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["creator", creatorId, "audience"],
    queryFn: () => apiRequest(`/v1/creators/${creatorId ?? ""}/audience`, audienceStateSchema),
    enabled: status === "signedIn" && creatorId !== null,
    refetchInterval: (query) => (isAudienceRunning(query.state.data) ? 2000 : false),
    retry: false,
  });
  // When a running estimate settles, its reservation was charged or returned: show the new balance.
  const wasRunning = useRef(false);
  const running = isAudienceRunning(q.data);
  useEffect(() => {
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: ["billing"] });
    wasRunning.current = running;
  }, [running, qc]);
  return q;
}

/** Sent only after the user confirmed the quote; the server reserves exactly `confirmedCost` or refuses. */
export function useRequestAudience(creatorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmedCost: number) =>
      apiRequest(`/v1/creators/${creatorId ?? ""}/audience/estimate`, audienceStateSchema, { method: "POST", body: { confirmedCost }, idempotencyKey: crypto.randomUUID() }),
    onSuccess: (state) => qc.setQueryData(["creator", creatorId, "audience"], state),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["creator", creatorId, "audience"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}
