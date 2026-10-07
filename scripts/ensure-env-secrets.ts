import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const path = ".env";
let text = existsSync(path) ? readFileSync(path, "utf8") : "";
const has = (key: string) => new RegExp(`^${key}=\\S+`, "m").test(text);
const added: string[] = [];

function ensure(key: string, value: string) {
  if (has(key)) return;
  const line = `${key}="${value}"`;
  text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  added.push(key);
}

ensure("DATA_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
ensure("STAFF_JWT_SECRET", randomBytes(48).toString("base64url"));
writeFileSync(path, text);
console.log(added.length ? `Added to .env: ${added.join(", ")}` : "Secrets already present; nothing changed.");
