/**
 * Rebuilds the PostgreSQL search documents of every creator in a disposable evaluation database after a projection
 * change, so before/after panel runs compare the same catalogue:
 *   TEST_DATABASE_URL=postgres://postgres@localhost:54330/mushin_eval_disposable TEST_DATABASE_SSL_CA_FILE= \
 *     node --import tsx scripts/search-eval/reindex.ts
 */
import { createLogger } from "@mushin/core";
import { createTestDatabase, ownerQuery } from "@mushin/db/testing";
import { createCreatorIndexer } from "../../apps/api/src/modules/creators/index";

const db = createTestDatabase(); // refuses anything but a local test/disposable database
const ids = (await ownerQuery<{ id: string }>("select id from gcp.creators")).map((r) => r.id);
await createCreatorIndexer({ db, index: null, logger: createLogger({ level: "silent" }) }).sync(ids);
console.log(`reindexed ${ids.length} creators`);
await db.close();
