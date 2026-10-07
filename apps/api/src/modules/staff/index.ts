import type { Db } from "@mushin/db";
import type { AppModule } from "../../http/types";
import type { StaffAction } from "./permissions";
import { createRequireStaff, registerStaffRoutes } from "./routes";
import { createStaffService } from "./service";
import type { StaffRole, StaffTokens } from "./tokens";

export { createStaffTokens } from "./tokens";
export type { StaffAction, StaffRole };

export function createStaffModule(o: { db: Db; tokens: StaffTokens; encryptionKey: Buffer; now?: () => Date }) {
  const service = createStaffService(o);
  const requireStaff = createRequireStaff(o.tokens);
  const module: AppModule = { name: "staff", register: (app) => registerStaffRoutes(app, service, requireStaff) };
  return { module, requireStaff, createStaffAccount: service.createStaffAccount };
}
