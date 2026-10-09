import type { CallContext } from "../instrumented";

export type WebResult = { title: string; link: string; snippet: string };
export type WebQuery = { query: string; country: string; num: number; ctx?: CallContext };

/** Google search behind an adapter (Serper now; SRS §3.4). */
export interface WebSearch {
  search(q: WebQuery): Promise<WebResult[]>;
}
