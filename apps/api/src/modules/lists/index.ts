import type { AppModule } from "../../http/types";
import { registerListRoutes } from "./routes";
import type { ListsService } from "./service";

export { createListsService } from "./service";
export type { ListsDeps, ListsService } from "./service";

export function createListsModule(o: { service: ListsService }): AppModule {
  return { name: "lists", register: (app, guards) => registerListRoutes(app, guards, o.service) };
}
