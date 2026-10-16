import { z } from "zod";
import { createExportSchema, dataExportListSchema, dataExportSchema } from "@mushin/contracts";
import { tenantOf } from "../../auth/customer-guard";
import type { AppModule } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import { createExportsService, type ExportsDeps } from "./service";

export { createExportsService, csvCell, EXPORT_TTL_MS, MAX_EXPORT_ROWS, type ExportsService } from "./service";

const idParams = z.object({ id: z.uuid() });

/** Scale-plan data export: create, list and download (private, never cached). */
export function createExportsModule(deps: ExportsDeps): AppModule {
  const service = createExportsService(deps);
  return {
    name: "exports",
    register(app, guards) {
      app.post("/v1/exports", { preHandler: [guards.customer, guards.idempotent] }, async (req, reply) =>
        sendOk(reply, dataExportSchema, await service.create(tenantOf(req), parseInput(createExportSchema, req.body).kind), 201),
      );
      app.get("/v1/exports", { preHandler: guards.customer }, async (req, reply) => sendOk(reply, dataExportListSchema, { exports: await service.list(tenantOf(req)) }));
      app.get("/v1/exports/:id/download", { preHandler: guards.customer }, async (req, reply) => {
        const file = await service.download(tenantOf(req), parseInput(idParams, req.params).id);
        void reply.header("content-type", "text/csv; charset=utf-8");
        void reply.header("content-disposition", `attachment; filename="${file.filename}"`);
        void reply.header("cache-control", "private, no-store");
        return reply.send(file.content);
      });
    },
  };
}
