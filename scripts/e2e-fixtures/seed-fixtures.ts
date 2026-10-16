/**
 * Loads the synthetic E2E catalogue (catalogue.ts) into the template database (audit OPS-02). Run by
 * build-template.sh after the migrations; the worker builds the search documents and index at start-up, as it does
 * for real data. Refuses any database but the synthetic template.
 */
import { loadApiConfig } from "@mushin/core";
import { createDatabase } from "@mushin/db";
import { insertCreator } from "../../apps/api/src/modules/creators/index";
import { FIXTURE_CREATORS } from "./catalogue";

if (!/\/mushin_e2e_synthetic_template$/.test(process.env["DATABASE_URL"] ?? "")) throw new Error("seed-fixtures runs only against mushin_e2e_synthetic_template");
const config = loadApiConfig(process.env);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-e2e-fixtures", caPem: null });
try {
  for (const c of FIXTURE_CREATORS) await db.withSystem((tx) => insertCreator(tx, c, config.dataEncryptionKey));
  console.log(`loaded ${FIXTURE_CREATORS.length} synthetic creators`);
} finally {
  await db.close();
}
