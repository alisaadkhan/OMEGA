import { randomUUID } from "node:crypto";
import { MeilisearchIndex } from "./meilisearch";

/** A fresh, uniquely named index on the test Meilisearch (integration tests only). */
export function testSearchIndex(): MeilisearchIndex {
  const host = process.env["MEILISEARCH_TEST_HOST"];
  const apiKey = process.env["MEILISEARCH_TEST_KEY"];
  if (!host || !apiKey) throw new Error("MEILISEARCH_TEST_HOST / MEILISEARCH_TEST_KEY are not set. Point them at a Meilisearch you can write to (README) in .env.");
  return new MeilisearchIndex({ host, apiKey, indexName: `test_${randomUUID().slice(0, 8)}_creators`, timeoutMs: 10_000 });
}
