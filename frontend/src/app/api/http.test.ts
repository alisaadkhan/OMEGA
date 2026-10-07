import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, readApiResponse } from "./http";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("readApiResponse", () => {
  it("returns parsed data on success", async () => {
    expect(await readApiResponse(json(200, { n: 1 }), z.object({ n: z.number() }))).toEqual({ n: 1 });
  });

  it("throws ApiError from the error envelope", async () => {
    const res = json(402, { error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits", requestId: "r9" } });
    await expect(readApiResponse(res, z.object({}))).rejects.toMatchObject({
      name: "ApiError",
      code: "INSUFFICIENT_CREDITS",
      status: 402,
      requestId: "r9",
      message: "Not enough credits",
    });
  });

  it("handles non-envelope failures and unexpected success bodies", async () => {
    const proxyError = new Response("<html>Bad gateway</html>", { status: 502, headers: { "x-request-id": "r1" } });
    await expect(readApiResponse(proxyError, z.object({}))).rejects.toBeInstanceOf(ApiError);
    await expect(readApiResponse(json(200, { n: "x" }), z.object({ n: z.number() }))).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
