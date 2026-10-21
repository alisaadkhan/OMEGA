/**
 * Complimentary plan, out of band with database credentials (never reachable from the API), audited in the staff
 * audit log like a Super Admin bootstrap. Gives a person's own workspace a plan for N months with no payment
 * (billing.grantComplimentaryPlan: monthly credits through the normal monthly grants, ends at the period end).
 *
 *   npm run grant-comp-plan -- --email person@example.com --plan scale --months 12 --operator "Your Name" --reason "why, 12+ characters" [--apply]
 * Dry run by default. The person must have signed in once (their workspace is created at first sign-in).
 */
import { parseArgs } from "node:util";
import { createLogger, loadApiConfig } from "@mushin/core";
import { createDatabase, createDbProviderCallSink, UNVERIFIED_TLS_WARNING } from "@mushin/db";
import { createPayments } from "@mushin/integrations";
import { sql } from "drizzle-orm";
import { createBillingService, noAccessCache } from "../apps/api/src/modules/billing/index";
import { recordStaffAudit } from "../apps/api/src/modules/staff/index";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    plan: { type: "string", default: "scale" },
    months: { type: "string", default: "12" },
    operator: { type: "string" },
    reason: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
const plan = values.plan as "explorer" | "growth" | "scale";
const months = Number(values.months);
if (!values.email || !["explorer", "growth", "scale"].includes(plan) || (values.operator ?? "").trim().length < 2 || (values.reason ?? "").trim().length < 12) {
  console.error('Usage: npm run grant-comp-plan -- --email person@example.com --plan scale --months 12 --operator "Your Name" --reason "why (12+ characters)" [--apply]');
  process.exit(1);
}

const config = loadApiConfig(process.env);
if (!config.databaseCaPem) console.warn(UNVERIFIED_TLS_WARNING);
const logger = createLogger({ level: "warn", name: "grant-comp-plan" });
const db = createDatabase(config.databaseUrl, { max: 1, applicationName: "mushin-grant-comp-plan", caPem: config.databaseCaPem });
try {
  // The person's own workspace (the one they own), found through the system role.
  const rows = await db.withSystem((tx) =>
    tx.execute<{ workspace_id: string; name: string; status: string | null; plan_id: string | null }>(sql`
      select w.id workspace_id, w.name, s.status, s.plan_id
      from wp.users u join wp.workspaces w on w.owner_user_id = u.id left join wp.subscriptions s on s.workspace_id = w.id
      where lower(u.email) = lower(${values.email ?? ""}) order by w.created_at limit 2`),
  );
  const target = rows[0];
  if (!target) {
    console.error(`No MUSHIN workspace is owned by ${values.email}. They must sign in to the app once first (the workspace is created then).`);
    process.exit(2);
  }
  if (rows.length > 1) console.warn(`${values.email} owns more than one workspace; using the oldest: ${rows[0]?.name}`);
  console.log(`Workspace "${target.name}" (${target.workspace_id}); current subscription: ${target.plan_id ?? "none"} ${target.status ?? ""}`.trim());
  console.log(`Grant: ${plan} for ${months} month(s), no payment, ending at the period end.`);
  if (!values.apply) {
    console.log("Dry run: nothing changed. Add --apply to grant it.");
  } else {
    const billing = createBillingService({ db, payments: createPayments(config.payments, { sink: createDbProviderCallSink(db), logger }), cache: noAccessCache, logger });
    const r = await billing.grantComplimentaryPlan({ workspaceId: target.workspace_id, planId: plan, months });
    await db.withSystem((tx) =>
      recordStaffAudit(tx, {
        staffId: null,
        action: "billing.comp_plan.granted",
        workspaceId: target.workspace_id,
        targetType: "workspace",
        targetId: target.workspace_id,
        metadata: { operator: values.operator?.trim(), reason: values.reason?.trim(), plan: r.planId, months, ref: r.ref, periodEnd: r.periodEnd.toISOString(), monthlyCredits: r.monthlyCredits },
        ip: null,
        requestId: null,
      }),
    );
    console.log(`Granted: ${r.planId} until ${r.periodEnd.toISOString().slice(0, 10)}; ${r.monthlyCredits.toLocaleString("en-US")} credits now and each month. Audited (billing.comp_plan.granted).`);
  }
} finally {
  await db.close();
}
