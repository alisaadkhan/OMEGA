import type { SearchRequest } from "@mushin/contracts";
import { AppError } from "@mushin/core";
import { searchChargeHash } from "./search-charge";

/**
 * Catalogue result pages are addressed by an opaque cursor bound to the normalised query, its filters and the ranker
 * version (CAT-004). A cursor from another search or an older ranking is refused instead of silently returning a page
 * of something else. Bump the version whenever ranking or matching changes.
 */
export const CATALOG_RANKER_VERSION = "catalog-2-aliases";
const MAX_OFFSET = 1000;

type CursorBody = { v: string; h: string; o: number };

const bind = (req: Pick<SearchRequest, "text" | "filters">) => searchChargeHash(req).slice(0, 24);

export function encodeCursor(req: Pick<SearchRequest, "text" | "filters">, offset: number): string {
  const body: CursorBody = { v: CATALOG_RANKER_VERSION, h: bind(req), o: offset };
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/** The offset a cursor points at; 0 without a cursor. */
export function decodeCursor(req: Pick<SearchRequest, "text" | "filters">, cursor: string | undefined, pageSize: number): number {
  if (!cursor) return 0;
  const stale = () => new AppError("VALIDATION_FAILED", "This page of results is out of date. Run the search again.", { reason: "stale_cursor" });
  let body: Partial<CursorBody>;
  try {
    body = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorBody>;
  } catch {
    throw stale();
  }
  const o = body.o;
  if (body.v !== CATALOG_RANKER_VERSION || body.h !== bind(req) || typeof o !== "number" || !Number.isInteger(o) || o < 0 || o > MAX_OFFSET || o % pageSize !== 0) {
    throw stale();
  }
  return o;
}
