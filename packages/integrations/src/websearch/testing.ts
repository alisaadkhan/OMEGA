import { readFileSync } from "node:fs";
import type { WebQuery, WebResult, WebSearch } from "./types";

/** A recorded real Serper response (fixtures/, recorded 2026-10-09), reduced to title, link and snippet. */
export function webSearchFixture(name: string): WebResult[] {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as { organic: WebResult[] };
  return body.organic;
}

type Reply = WebResult[] | Error | ((q: WebQuery) => WebResult[] | Promise<WebResult[]>);

/** Test double: answers every search (or throws) and records each query. */
export class FixtureWebSearch implements WebSearch {
  readonly calls: WebQuery[] = [];
  constructor(private readonly reply: Reply) {}

  async search(q: WebQuery): Promise<WebResult[]> {
    this.calls.push(q);
    if (this.reply instanceof Error) throw this.reply;
    return typeof this.reply === "function" ? this.reply(q) : this.reply;
  }
}
