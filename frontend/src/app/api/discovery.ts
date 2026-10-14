import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discoveryJobListSchema, discoveryJobSchema, discoveryResultsResponseSchema, liveEstimateSchema, startDiscoveryJobResponseSchema, type CreateLiveEstimate, type DiscoveryResult, type StartDiscoveryJob } from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";
import { isOpenJob, mergeResults } from "./discovery-mapping";

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

/** Asks a running live search to stop; it settles what was already delivered (JOB-003). */
export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => apiRequest(`/v1/discovery/jobs/${jobId}/cancel`, discoveryJobSchema, { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["discovery"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

export function useCreateLiveEstimate() {
  return useMutation({
    mutationFn: (body: CreateLiveEstimate) =>
      apiRequest("/v1/discovery/estimates", liveEstimateSchema, { method: "POST", body, idempotencyKey: crypto.randomUUID() }),
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

export function useDiscoveryJob(jobId: string | null) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["discovery", "job", jobId],
    queryFn: () => apiRequest(`/v1/discovery/jobs/${jobId ?? ""}`, discoveryJobSchema),
    enabled: status === "signedIn" && jobId !== null,
    refetchInterval: (query) => (query.state.data && !isOpenJob(query.state.data) ? false : 2000),
  });
}

/**
 * Spec §6: polls a live run's results every 2 s, asking only for results after the last one seen, until the run is done;
 * the last poll re-reads the whole list once so the final ranks show.
 */
export function useLiveResults(jobId: string | null) {
  const { status } = useAuth();
  const acc = useRef<{ jobId: string | null; results: DiscoveryResult[] }>({ jobId: null, results: [] });
  const q = useQuery({
    queryKey: ["discovery", "results", jobId],
    queryFn: async () => {
      if (acc.current.jobId !== jobId) acc.current = { jobId, results: [] };
      const after = acc.current.results.reduce((m, r) => Math.max(m, r.seq), 0);
      const page = await apiRequest(`/v1/discovery/jobs/${jobId ?? ""}/results?after=${after}`, discoveryResultsResponseSchema);
      let results = mergeResults(acc.current.results, page.results);
      if (page.done) results = mergeResults([], (await apiRequest(`/v1/discovery/jobs/${jobId ?? ""}/results?after=0`, discoveryResultsResponseSchema)).results);
      acc.current = { jobId, results };
      return { results, done: page.done };
    },
    enabled: status === "signedIn" && jobId !== null,
    refetchInterval: (query) => (query.state.data?.done ? false : 2000),
  });
  return {
    results: jobId === null ? [] : (q.data?.results ?? []),
    done: q.data?.done ?? false,
    isError: q.isError,
    error: q.error,
    retry: q.refetch,
  };
}
