import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  creatorProfileSchema,
  interpretResponseSchema,
  lookupResponseSchema,
  revealRemovedSchema,
  revealResponseSchema,
  savedSearchListSchema,
  savedSearchSchema,
  searchResponseSchema,
  type SearchFilters,
  type SearchRequest,
} from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";

export function useCreatorSearch(req: SearchRequest | null) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["search", req],
    queryFn: () => apiRequest("/v1/search", searchResponseSchema, { method: "POST", body: req }),
    enabled: status === "signedIn" && req !== null,
    staleTime: 30_000,
  });
}

export function useInterpret() {
  return useMutation({
    mutationFn: (text: string) => apiRequest("/v1/search/interpret", interpretResponseSchema, { method: "POST", body: { text } }),
  });
}

export function useSavedSearches() {
  const { status } = useAuth();
  return useQuery({ queryKey: ["search", "saved"], queryFn: () => apiRequest("/v1/search/saved", savedSearchListSchema), enabled: status === "signedIn" });
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; queryText: string; filters: SearchFilters }) => apiRequest("/v1/search/saved", savedSearchSchema, { method: "POST", body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["search", "saved"] }),
  });
}

/** Polls every 2 s for up to 30 s while the AI summary is being written. */
export function useCreatorProfile(id: string | null) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["creator", id],
    queryFn: () => apiRequest(`/v1/creators/${id ?? ""}`, creatorProfileSchema),
    enabled: status === "signedIn" && id !== null,
    refetchInterval: (q) => (q.state.data?.summary.status === "generating" && q.state.dataUpdateCount < 15 ? 2000 : false),
  });
}

export function useRevealContact(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmedCost: number) =>
      apiRequest(`/v1/creators/${id ?? ""}/reveal`, revealResponseSchema, { method: "POST", body: { confirmedCost }, idempotencyKey: crypto.randomUUID() }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["creator", id] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });
}

export function useCreatorLookup(q: string) {
  const { status } = useAuth();
  const text = q.trim();
  return useQuery({
    queryKey: ["creator", "lookup", text],
    queryFn: () => apiRequest(`/v1/creators/lookup?q=${encodeURIComponent(text)}`, lookupResponseSchema),
    enabled: status === "signedIn" && text.length >= 2,
    staleTime: 30_000,
  });
}

export function useForgetReveal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest(`/v1/creators/${id ?? ""}/reveal`, revealRemovedSchema, { method: "DELETE" }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["creator", id] }),
  });
}
