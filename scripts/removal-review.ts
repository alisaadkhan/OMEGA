/**
 * Owner review of creator removal requests while console approval is blocked (owner decision 2026-10-15: removal
 * requests stay under owner review until hardware-key staff sign-in and approval controls work). A creator named in a
 * request is already hidden from every customer surface when the request arrives; this decides what happens next.
 *
 *   npm run removal-review -- list [--status received|processed|rejected]
 *   npm run removal-review -- approve --id <request id> --operator "Your Name" --reason "why it is valid" --confirm
 *   npm run removal-review -- reject  --id <request id> --operator "Your Name" --reason "why it is not valid"
 *
 * Needs the API's DATABASE_URL and data key, which only the owner holds. Approval queues the erasure (worker); it cannot
 * be undone. Every decision writes the same audit entry as the console, with channel "owner-cli", the operator and the
 * reason. The requester's email is shown masked, as in the console.
 */
import { parseArgs } from "node:util";
import { loadApiConfig } from "@mushin/core";
import { createDatabase, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createRemovalService } from "../apps/api/src/modules/creators/index";
import { recordStaffAudit } from "../apps/api/src/modules/staff/index";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { status: { type: "string", default: "received" }, id: { type: "string" }, operator: { type: "string" }, reason: { type: "string" }, confirm: { type: "boolean", default: false } },
});
const [command] = positionals;
const usage = () => {
  console.error("Usage: npm run removal-review -- list [--status received|processed|rejected]");
  console.error('       npm run removal-review -- approve|reject --id <id> --operator "Your Name" --reason "..." [--confirm for approve]');
  process.exit(1);
};
if (command !== "list" && command !== "approve" && command !== "reject") usage();
const status = values.status;
if (status !== "received" && status !== "processed" && status !== "rejected") usage();

const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-removal-review", caPem: config.databaseCaPem });
const removals = createRemovalService({ db, encryptionKey: config.dataEncryptionKey, audit: recordStaffAudit });
try {
  if (command === "list") {
    const requests = await removals.list(status as "received" | "processed" | "rejected");
    const days = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    for (const r of requests) {
      console.log(`${r.id}  received ${r.createdAt.slice(0, 10)} (${days(r.createdAt)} days ago)${r.processedAt ? `, ${r.status} ${r.processedAt.slice(0, 10)}` : ""}`);
      console.log(`  links: ${r.urls.join(", ")}`);
      console.log(`  creator: ${r.creator ? `${r.creator.displayName} (@${r.creator.handle}, ${r.creator.platform})` : "not in MUSHIN (nothing to erase; links are still suppressed on approval)"}`);
      console.log(`  requester: ${r.emailMasked ?? "(email already cleared)"}; reason: ${r.reason ?? "(none given)"}${r.staffNote ? `; note: ${r.staffNote}` : ""}`);
    }
    console.log(`${requests.length} ${status} request(s).`);
  } else {
    const operator = values.operator?.trim() ?? "";
    const reason = values.reason?.trim() ?? "";
    if (!values.id || operator.length < 2 || reason.length < 5) usage();
    if (command === "approve" && !values.confirm) {
      console.error("Approval erases the creator's data and cannot be undone. Re-run with --confirm.");
      process.exit(1);
    }
    const actor = { ownerCli: { operator, reason } };
    const meta = { ip: null, requestId: `owner-cli-${Date.now()}` };
    if (command === "approve") await removals.approve(values.id ?? "", actor, meta);
    else await removals.reject(values.id ?? "", reason, actor, meta);
    console.log(`${command === "approve" ? "Approved: erasure queued" : "Rejected: creator restored unless another open request names them"}; audit entry written (${meta.requestId}).`);
  }
} finally {
  await db.close();
}
