import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestIdFrom(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && VALID.test(value) ? value : randomUUID();
}
