import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { insertCreator } from "../apps/api/src/modules/creators/index";
import { DEMO_CREATORS } from "./seed-data/creators";

const config = loadApiConfig(process.env);
if (config.nodeEnv === "production") {
  console.error("seed:creators loads demo creators and is refused in production (architecture Q15).");
  process.exit(1);
}
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-seed-creators", caPem: config.databaseCaPem });
try {
  let added = 0;
  for (const c of DEMO_CREATORS) {
    try {
      await db.withSystem((tx) => insertCreator(tx, c, config.dataEncryptionKey));
      added += 1;
    } catch (err) {
      if (err instanceof Error && /duplicate key|unique/.test(`${err.message} ${String(err.cause)}`)) continue; // already seeded
      throw err;
    }
  }
  console.log(`Seeded ${added} demo creators (${DEMO_CREATORS.length - added} already present). The worker indexes them for search within seconds.`);
} finally {
  await db.close();
}
