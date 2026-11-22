import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PreHandler } from "../../http/types";
import { parseInput, sendOk } from "../../http/validate";
import type { StaffAction, StaffPrincipal } from "../staff/index";
import { creatorEditSchema, creatorListQuerySchema, creatorReasonSchema, staffCreatorListSchema, type createCreatorEditor } from "./creator-editor";

const idParams = z.object({ id: z.uuid() });
const ok = z.object({ ok: z.literal(true) });

/** Staff creator editor (owner, 22 Nov): everyone reads; Admins edit and hide; removal is a data-removal decision. */
export function registerCreatorEditorRoutes(
  app: FastifyInstance,
  o: { editor: ReturnType<typeof createCreatorEditor>; r: (a: StaffAction) => PreHandler; staffOf: (req: FastifyRequest) => StaffPrincipal; meta: (req: FastifyRequest) => { ip: string | null; requestId: string } },
) {
  app.get("/admin/v1/catalogue/all", { preHandler: o.r("catalogue.review.read") }, async (req, reply) =>
    sendOk(reply, staffCreatorListSchema, await o.editor.list(parseInput(creatorListQuerySchema, req.query))),
  );
  app.patch("/admin/v1/catalogue/creators/:id", { preHandler: o.r("catalogue.review.decide") }, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    await o.editor.update(o.staffOf(req), id, parseInput(creatorEditSchema, req.body), o.meta(req));
    return sendOk(reply, ok, { ok: true });
  });
  for (const [path, hidden] of [["hide", true], ["unhide", false]] as const) {
    app.post(`/admin/v1/catalogue/creators/:id/${path}`, { preHandler: o.r("catalogue.review.decide") }, async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      await o.editor.setHidden(o.staffOf(req), id, hidden, parseInput(creatorReasonSchema, req.body).reason, o.meta(req));
      return sendOk(reply, ok, { ok: true });
    });
  }
  app.post("/admin/v1/catalogue/creators/:id/remove", { preHandler: o.r("creators.removal.review") }, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    await o.editor.remove(o.staffOf(req), id, parseInput(creatorReasonSchema, req.body).reason, o.meta(req));
    return sendOk(reply, ok, { ok: true });
  });
}
