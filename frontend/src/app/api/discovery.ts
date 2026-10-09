import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discoveryJobListSchema, startDiscoveryJobResponseSchema, type StartDiscoveryJob } from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";
import { isOpenJob } from "./discovery-mapping";

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartDiscoveryJob) =>
      apiRequest("/v1/discovery/jobs", startDiscoveryJobResponseSchema, { method: "POST", body, idempotencyKey: crypto.randomUUID() }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["discovery"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

/** Polls every 2 s while a job is open (SRS §3.4), otherwise every 30 s. */
export function useActiveJobs() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["discovery", "active"],
    queryFn: () => apiRequest("/v1/discovery/jobs?active=true", discoveryJobListSchema),
    enabled: status === "signedIn",
    refetchInterval: (q) => (q.state.data?.jobs.some(isOpenJob) ? 2000 : 30_000),
  });
}
