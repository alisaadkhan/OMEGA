import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  addCampaignCreatorsResponseSchema,
  campaignDetailSchema,
  campaignIndexSchema,
  campaignSummarySchema,
  outreachEventSchema,
  outreachLogSchema,
  type CampaignDetail,
  type CreateCampaign,
  type LogOutreach,
  type UpdateCampaign,
  type UpdateCampaignCreator,
} from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { applyCreatorUpdate } from "./campaigns-mapping";
import { apiRequest } from "./client";

const noContent = z.null();

export function useCampaigns(creatorId?: string | null, enabled = true) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["campaigns", "index", creatorId ?? null],
    queryFn: () => apiRequest(`/v1/campaigns${creatorId ? `?creatorId=${creatorId}` : ""}`, campaignIndexSchema),
    enabled: status === "signedIn" && enabled,
  });
}

export function useCampaign(id: string | null) {
  const { status } = useAuth();
  return useQuery({ queryKey: ["campaigns", "detail", id], queryFn: () => apiRequest(`/v1/campaigns/${id ?? ""}`, campaignDetailSchema), enabled: status === "signedIn" && id !== null });
}

export function useOutreachLog(campaignId: string, creatorId: string | null) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["campaigns", "outreach", campaignId, creatorId],
    queryFn: () => apiRequest(`/v1/campaigns/${campaignId}/creators/${creatorId ?? ""}/outreach`, outreachLogSchema),
    enabled: status === "signedIn" && creatorId !== null,
  });
}

function useCampaignMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void qc.invalidateQueries({ queryKey: ["campaigns"] }) });
}

export const useCreateCampaign = () => useCampaignMutation((body: CreateCampaign) => apiRequest("/v1/campaigns", campaignSummarySchema, { method: "POST", body }));
export const useUpdateCampaign = () =>
  useCampaignMutation(({ id, patch }: { id: string; patch: UpdateCampaign }) => apiRequest(`/v1/campaigns/${id}`, campaignSummarySchema, { method: "PATCH", body: patch }));
export const useDeleteCampaign = () => useCampaignMutation((id: string) => apiRequest(`/v1/campaigns/${id}`, noContent, { method: "DELETE" }));
export const useAddToCampaign = () =>
  useCampaignMutation(({ id, creatorIds }: { id: string; creatorIds: string[] }) =>
    apiRequest(`/v1/campaigns/${id}/creators`, addCampaignCreatorsResponseSchema, { method: "POST", body: { creatorIds } }),
  );
export const useRemoveFromCampaign = () =>
  useCampaignMutation(({ id, creatorId }: { id: string; creatorId: string }) => apiRequest(`/v1/campaigns/${id}/creators/${creatorId}`, noContent, { method: "DELETE" }));
export function useUpdateCampaignCreator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, creatorId, patch }: { id: string; creatorId: string; patch: UpdateCampaignCreator }) =>
      apiRequest(`/v1/campaigns/${id}/creators/${creatorId}`, z.object({ version: z.number() }), { method: "PATCH", body: patch }),
    onSuccess: ({ version }, { id, creatorId, patch }) => qc.setQueryData<CampaignDetail>(["campaigns", "detail", id], (d) => applyCreatorUpdate(d, creatorId, patch, version)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}
export const useLogOutreach = () =>
  useCampaignMutation(({ id, creatorId, body }: { id: string; creatorId: string; body: LogOutreach }) =>
    apiRequest(`/v1/campaigns/${id}/creators/${creatorId}/outreach`, outreachEventSchema, { method: "POST", body }),
  );

/** PKR amounts are stored in paisa; shown in whole rupees. */
export const rupees = (minor: number | null) => (minor === null ? "—" : `Rs ${Math.round(minor / 100).toLocaleString("en-PK")}`);
export const toMinor = (rupeesText: string): number | null => {
  const n = Number(rupeesText.replace(/[^0-9.]/g, ""));
  return rupeesText.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
};
