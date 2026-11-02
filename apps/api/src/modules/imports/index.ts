import { z } from "zod";
import { createImportSchema, importDetailSchema, importListSchema, IMPORT_MAX_BYTES } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { ImportsService } from "./service";

export { createImportsService, parseCsv, type ImportsService } from "./service";

const idParams = z.object({ id: z.uuid() });

/** Creator list imports: upload a CSV, see each row's outcome, list past imports (workspace-private). */
export function createImportsModule(o: { service: ImportsService }): AppModule {
  return {
    name: "imports",
    register(app, guards) {
      const read = { preHandler: guards.customer };
      app.get("/v1/imports", read, async (req, reply) => sendOk(reply, importListSchema, { imports: await o.service.list(tenantOf(req)) }));
      app.get("/v1/imports/:id", read, async (req, reply) => sendOk(reply, importDetailSchema, await o.service.detail(tenantOf(req), parseInput(idParams, req.params).id)));
      // The CSV travels as JSON text: allow a little over the file limit for the JSON envelope and escaping.
      app.post("/v1/imports", { preHandler: [guards.customer, guards.idempotent], bodyLimit: Math.round(IMPORT_MAX_BYTES * 1.5) }, async (req, reply) => {
        const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined;
        if (!key) throw new AppError("VALIDATION_FAILED", "Idempotency-Key header is required");
        return sendOk(reply, importDetailSchema, await o.service.create(tenantOf(req), parseInput(createImportSchema, req.body), key), 201);
      });
    },
  };
}
