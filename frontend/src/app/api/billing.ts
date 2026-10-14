import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  billingPlansSchema,
  billingSummarySchema,
  checkoutResponseSchema,
  invoicesResponseSchema,
  ledgerPageSchema,
  planChangeResponseSchema,
  type CheckoutRequest,
  type CreditAction,
  type PlanChangeRequest,
} from "@mushin/contracts";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "./client";

const keys = {
  all: ["billing"] as const,
  summary: ["billing", "summary"] as const,
  plans: ["billing", "plans"] as const,
  ledger: ["billing", "ledger"] as const,
  invoices: ["billing", "invoices"] as const,
};

export function useBillingSummary() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => apiRequest("/v1/billing/summary", billingSummarySchema),
    enabled: status === "signedIn",
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useBillingPlans() {
  const { status } = useAuth();
  return useQuery({
    queryKey: keys.plans,
    queryFn: () => apiRequest("/v1/billing/plans", billingPlansSchema),
    enabled: status === "signedIn",
    staleTime: 5 * 60_000,
  });
}

/** Current credit prices from the server, the only source of prices (null while loading). */
export function useActionCosts(): Record<CreditAction, number> | null {
  return useBillingPlans().data?.actionCosts ?? null;
}

export function useLedger(enabled: boolean) {
  return useQuery({ queryKey: keys.ledger, queryFn: () => apiRequest("/v1/billing/ledger?limit=20", ledgerPageSchema), enabled });
}

export function useInvoices(enabled: boolean) {
  return useQuery({ queryKey: keys.invoices, queryFn: () => apiRequest("/v1/billing/invoices", invoicesResponseSchema), enabled });
}

/** Opens the payment provider's hosted checkout (mock or Paddle) in this tab. */
export function useStartCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CheckoutRequest) =>
      apiRequest("/v1/billing/checkout", checkoutResponseSchema, { method: "POST", body: req, idempotencyKey: crypto.randomUUID() }),
    onSuccess: ({ url }) => window.location.assign(url),
    // A refused checkout (e.g. a plan became active meanwhile) means this screen's billing data is out of date.
    onError: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PlanChangeRequest) =>
      apiRequest("/v1/billing/subscription/change", planChangeResponseSchema, { method: "POST", body: req, idempotencyKey: crypto.randomUUID() }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest("/v1/billing/subscription/cancel", planChangeResponseSchema, { method: "POST", idempotencyKey: crypto.randomUUID() }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useRefreshBilling() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}
