import { useMutation } from "@tanstack/react-query";
import { productReviewCreatedSchema, type ProductReviewCreate } from "@mushin/contracts";
import { apiRequest } from "./client";

/** "Leave a review": stored for the MUSHIN team; no email is sent for it. */
export function useLeaveReview() {
  return useMutation({ mutationFn: (body: ProductReviewCreate) => apiRequest("/v1/feedback", productReviewCreatedSchema, { method: "POST", body }) });
}
