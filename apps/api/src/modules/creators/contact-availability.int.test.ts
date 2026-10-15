import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { searchFiltersSchema } from "@mushin/contracts";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockLlm, MockPayments, UnavailableSearchIndex } from "@mushin/integrations";
import { createBillingService, MemoryAccessCache } from "../billing/index";
import { createCampaignsService } from "../campaigns/index";
import { createContactChecker } from "./contact-checks";
import { createCreatorIndexer } from "./indexer";
import type { MailResolver } from "./email-check";
import { createPostgresCatalogSearch } from "./postgres-search";
import * as repo from "./repository";
import { createCreatorsService } from "./service";
import { addCreator, TEST_KEY } from "./test-fixtures";

const db = createTestDatabase();
const logger = createLogger({ level: "silent" });
const payments = new MockPayments({ webhookSecret: "s".repeat(40), publicApiUrl: "http://api.test", deliver: async () => {} });
const billing = createBillingService({ db, payments, cache: new MemoryAccessCache(), logger });
const creators = createCreatorsService({ db, index: new UnavailableSearchIndex(), nativeSearch: createPostgresCatalogSearch(db), llm: new MockLlm(() => ({})), billing, encryptionKey: TEST_KEY, logger });
const campaigns = createCampaignsService({ db });
const indexer = createCreatorIndexer({ db, index: null, logger });
beforeEach(resetTables);
afterAll(() => db.close());

async function customer(): Promise<TenantContext> {
  const ws = await createTestWorkspace();
  await db.withTenant(ws, (tx) => billing.startTrial(tx, ws.workspaceId));
  return { ...ws, requestId: `req-${randomUUID().slice(0, 8)}`, role: "owner" };
}
const email = (value: string, source = "bio") => ({ kind: "email" as const, value, trust: "unverified" as const, source });
const phone = { kind: "phone" as const, value: "+923001234567", trust: "unverified" as const, source: "bio" };
const setStatus = (creatorId: string, status: string) => ownerQuery(`update gcp.creator_contacts set status = '${status}', checked_at = now(), check_detail = 'test' where creator_id = '${creatorId}' and kind = 'email'`);
const card = async (c: TenantContext, id: string) => (await db.withTenant(c, (tx) => repo.cardRows(tx, [id])))[0];
const checkEvents = () => ownerQuery<{ payload: { creatorId: string; workspaceId: string } }>(`select payload from platform.outbox where event_type = 'outreach.contact_check_requested'`);
const resolverWith = (answers: Record<string, "mx" | "nxdomain" | "timeout">): MailResolver & { lookups: string[] } => {
  const lookups: string[] = [];
  const err = (code: string) => Object.assign(new Error(code), { code });
  return {
    lookups,
    async mx(domain) {
      lookups.push(domain);
      const a = answers[domain];
      if (a === "mx") return [{ exchange: `mx.${domain}`, priority: 10 }];
      throw err(a === "timeout" ? "ETIMEOUT" : "ENOTFOUND");
    },
    hasAddress: async () => false,
  };
};

describe("contact availability on cards and profiles", () => {
  it("shows what is known without revealing anything: email unverified, phone only, invalid, none", async () => {
    const c = await customer();
    const withEmail = await addCreator(db, { displayName: "Has Email", contacts: [email("collabs@sana.pk", "business_field")] });
    const phoneOnly = await addCreator(db, { displayName: "Phone Only", contacts: [phone] });
    const badEmail = await addCreator(db, { displayName: "Bad Email", contacts: [email("old@gone.pk")] });
    const nothing = await addCreator(db, { displayName: "No Contact" });
    await setStatus(badEmail, "invalid");
    await indexer.sync([withEmail, phoneOnly, badEmail, nothing]);

    const search = await creators.search(c, { text: "", filters: searchFiltersSchema.parse({}), confirmedCost: 50 });
    const byName = new Map(search.results.map((r) => [r.displayName, r]));
    expect(byName.get("Has Email")).toMatchObject({ contactAvailability: "email_unverified", hasContact: true });
    expect(byName.get("Phone Only")).toMatchObject({ contactAvailability: "phone_unverified", hasContact: true });
    expect(byName.get("Bad Email")).toMatchObject({ contactAvailability: "email_invalid", hasContact: false });
    expect(byName.get("No Contact")).toMatchObject({ contactAvailability: "none", hasContact: false });
    expect(JSON.stringify(search)).not.toContain("collabs@sana.pk");

    const p = await creators.profile(c, withEmail);
    expect(p.contactAvailability).toBe("email_unverified");
    expect(p.revealed).toBe(false);
    expect(p.contacts).toEqual([
      expect.objectContaining({ kind: "email", value: null, masked: expect.not.stringContaining("collabs@"), source: "business_field", status: "unverified", checkedAt: null, firstSeenAt: expect.any(String), lastSeenAt: expect.any(String) }),
    ]);
    expect((await creators.profile(c, nothing)).contactAvailability).toBe("none");
    expect((await creators.profile(c, phoneOnly)).contactAvailability).toBe("phone_unverified");
  });

  it("a domain that checks out is still unverified; only addresses shown not to work drop out of the contact filter", async () => {
    const c = await customer();
    const ok = await addCreator(db, { displayName: "Domain Ok", contacts: [email("hi@sana.pk")] });
    const mixed = await addCreator(db, { displayName: "One Bad One Unchecked", contacts: [email("hi@gone.pk"), email("hi@other.pk")] });
    const bad = await addCreator(db, { displayName: "All Bad", contacts: [email("hi@gone2.pk")] });
    await setStatus(ok, "domain_ok");
    await ownerQuery(`update gcp.creator_contacts set status = 'invalid' where creator_id = '${mixed}' and masked like '%gone%'`);
    await setStatus(bad, "invalid");
    await indexer.sync([ok, mixed, bad]);
    expect((await card(c, ok))?.contactStates).toEqual([{ kind: "email", status: "domain_ok" }]);
    const cards = (await creators.search(c, { text: "", filters: searchFiltersSchema.parse({ hasContact: true }), confirmedCost: 50 })).results;
    expect(cards.map((r) => [r.displayName, r.contactAvailability]).sort()).toEqual([["Domain Ok", "email_unverified"], ["One Bad One Unchecked", "email_unverified"]]);
  });

  it("refuses to sell a reveal of addresses that were all shown not to work", async () => {
    const c = await customer();
    const bad = await addCreator(db, { contacts: [email("hi@gone.pk")] });
    await setStatus(bad, "invalid");
    expect((await creators.profile(c, bad)).hasContacts).toBe(false);
    await expect(creators.reveal(c, bad, 5)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await billing.summary(c)).balance.available).toBe(200);
  });
});

describe("email check on first use in a campaign", () => {
  async function campaignWith(c: TenantContext, creatorId: string) {
    const k = await campaigns.create(c, { name: "Eid", status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null });
    await campaigns.addCreators(c, k.id, [creatorId]);
    return k.id;
  }

  it("is queued only for a workspace that revealed the contacts, only for email, and only until the address was checked", async () => {
    const c = await customer();
    const id = await addCreator(db, { contacts: [email("collabs@sana.pk")] });
    const k = await campaignWith(c, id);
    await campaigns.logOutreach(c, k, id, { channel: "email", outcome: "attempted", note: "" });
    expect(await checkEvents()).toEqual([]); // not revealed: this workspace does not hold the address
    await creators.reveal(c, id, 5);
    await campaigns.logOutreach(c, k, id, { channel: "whatsapp", outcome: "attempted", note: "" });
    expect(await checkEvents()).toEqual([]);
    await campaigns.logOutreach(c, k, id, { channel: "email", outcome: "attempted", note: "" });
    expect(await checkEvents()).toEqual([{ payload: { creatorId: id, workspaceId: c.workspaceId } }]);
    await setStatus(id, "domain_ok");
    await campaigns.logOutreach(c, k, id, { channel: "email", outcome: "replied", note: "" });
    expect(await checkEvents()).toHaveLength(1);
    // Logging outreach records what the brand did; nothing claims a message was sent or delivered by MUSHIN.
    const log = await campaigns.outreach(c, k, id);
    expect(log.events.every((e) => !("delivered" in e) && !("sent" in e))).toBe(true);
  });

  it("the worker records each check as evidence; DNS failure leaves the address unchecked; invalid re-indexes the creator", async () => {
    const id = await addCreator(db, { contacts: [email("collabs@sana.pk"), email("old@gone.pk"), email("x@slowdns.pk")] });
    const resolver = resolverWith({ "sana.pk": "mx", "gone.pk": "nxdomain", "slowdns.pk": "timeout" });
    const checker = createContactChecker({ db, encryptionKey: TEST_KEY, resolver, logger });
    const ws = randomUUID();
    const changed = async () => (await ownerQuery(`select 1 from platform.outbox where event_type = 'creator.changed' and payload->>'creatorId' = '${id}'`)).length;
    const before = await changed();
    expect(await checker.check(id, ws)).toEqual({ checked: 2, invalid: 1, failed: 1 });

    const contacts = await ownerQuery<{ masked: string; status: string; check_detail: string | null; checked: boolean }>(
      `select masked, status, check_detail, checked_at is not null as checked from gcp.creator_contacts where creator_id = '${id}' order by masked`);
    expect(contacts.map((k) => [k.status, k.check_detail, k.checked]).sort()).toEqual([["domain_ok", "mx_found", true], ["invalid", "no_such_domain", true], ["unverified", null, false]]);
    const checks = await ownerQuery<{ result: string; detail: string; method: string; requested_by_workspace_id: string }>(`select result, detail, method, requested_by_workspace_id from gcp.contact_checks order by result`);
    expect(checks).toEqual([
      { result: "check_failed", detail: "dns_etimeout", method: "format_domain_mx", requested_by_workspace_id: ws },
      { result: "domain_ok", detail: "mx_found", method: "format_domain_mx", requested_by_workspace_id: ws },
      { result: "invalid", detail: "no_such_domain", method: "format_domain_mx", requested_by_workspace_id: ws },
    ]);
    expect((await changed()) - before).toBe(1);
    // A domain that accepts mail is not proof of an inbox: the creator still reads "Email available · Unverified".
    const c = await customer();
    expect((await creators.profile(c, id)).contactAvailability).toBe("email_unverified");

    // Only the address whose lookup failed is tried again; checked ones are not re-checked.
    resolver.lookups.length = 0;
    await checker.check(id, ws);
    expect(resolver.lookups).toEqual(["slowdns.pk"]);
  });

  it("checks are deleted with the creator's contacts (erasure)", async () => {
    const id = await addCreator(db, { contacts: [email("collabs@sana.pk")] });
    await createContactChecker({ db, encryptionKey: TEST_KEY, resolver: resolverWith({ "sana.pk": "mx" }), logger }).check(id, null);
    await db.withSystem(async (tx) => {
      const { eraseRows } = await import("./erasure/repository");
      await eraseRows(tx, id, []);
    });
    expect(await ownerQuery(`select 1 from gcp.contact_checks`)).toEqual([]);
  });
});
