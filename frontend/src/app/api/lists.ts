import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { addListMembersResponseSchema, listDetailSchema, listIndexSchema, listSummarySchema, type CreateList, type UpdateList } from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";

const noContent = z.null();

/** All workspace lists; with a creator id each list also says whether that creator is on it. */
export function useLists(creatorId?: string | null, enabled = true) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["lists", "index", creatorId ?? null],
    queryFn: () => apiRequest(`/v1/lists${creatorId ? `?creatorId=${creatorId}` : ""}`, listIndexSchema),
    enabled: status === "signedIn" && enabled,
  });
}

export function useList(id: string | null) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["lists", "detail", id],
    queryFn: () => apiRequest(`/v1/lists/${id ?? ""}`, listDetailSchema),
    enabled: status === "signedIn" && id !== null,
  });
}

function useListMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void qc.invalidateQueries({ queryKey: ["lists"] }) });
}

export const useCreateList = () => useListMutation((body: CreateList) => apiRequest("/v1/lists", listSummarySchema, { method: "POST", body }));
export const useUpdateList = () =>
  useListMutation(({ id, patch }: { id: string; patch: UpdateList }) => apiRequest(`/v1/lists/${id}`, listSummarySchema, { method: "PATCH", body: patch }));
export const useDeleteList = () => useListMutation((id: string) => apiRequest(`/v1/lists/${id}`, noContent, { method: "DELETE" }));
export const useAddToList = () =>
  useListMutation(({ id, creatorIds }: { id: string; creatorIds: string[] }) =>
    apiRequest(`/v1/lists/${id}/members`, addListMembersResponseSchema, { method: "POST", body: { creatorIds } }),
  );
export const useRemoveFromList = () =>
  useListMutation(({ id, creatorIds }: { id: string; creatorIds: string[] }) =>
    apiRequest(`/v1/lists/${id}/members/remove`, z.object({ removed: z.number() }), { method: "POST", body: { creatorIds } }),
  );
export const useSetListNote = () =>
  useListMutation(({ id, creatorId, note }: { id: string; creatorId: string; note: string }) =>
    apiRequest(`/v1/lists/${id}/members/${creatorId}`, noContent, { method: "PATCH", body: { note } }),
  );
