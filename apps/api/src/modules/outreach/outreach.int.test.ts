import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, type TenantContext } from "@mushin/core";
import { createTestDatabase, createTestWorkspace, ownerQuery, resetTables } from "@mushin/db/testing";
import { MockEmailProvider, signEmailWebhook, WebhookSignatureError } from "@mushin/integrations";
import { createCreditEngine } from "../billing/index";
import { createCampaignsService } from "../campaigns/index";
import { addIndexedCreator, TEST_KEY } from "../creators/test-fixtures";
import { createOutreachEmailService, SENDS_PER_USER_PER_HOUR } from "./service";

/** Outreach email (owner decision 2026-10-16): mock provider only; nothing is delivered. */
const db = createTestDatabase();
beforeEach(resetTables);
afterAll(() => db.close());

const SECRET = `whsec_${Buffer.from("s".repeat(32)).toString("base64")}`;
let limit: number | null = 500;
let provider = new MockEmailProvider();
const billing = {
  getAccess: async () => ({ status: "active" as const, planId: "growth" as const, entitlements: { audienceViewsPerMonth: null, outreachEmailsPerMonth: limit, campaignLimit: null, export: false }, spend: "all" as const }),
  engine: createCreditEngine(),
};
const service = (o: { off?: boolean } = {}) =>
  createOutreachEmailService({ db, billing, provider: o.off ? null : provider, from: "MUSHIN test <outreach@test.invalid>", encryptionKey: TEST_KEY, unsubscribeKey: Buffer.alloc(32, 7), appUrl: "https://app.mushin.test", webhookSecret: SECRET, logger: createLogger({ level: "silent" }) });
const campaigns = createCampaignsService({ db, planLimits: async () => ({ entitlements: { campaignLimit: null } }) });

beforeEach(() => {
  limit = 500;
  provider = new MockEmailProvider();
});

const base = { status: "draft", platform: null, client: "", objective: "", notes: "", budgetMinor: null, startDate: null, endDate: null } as const;
async function setup(o: { reveal?: boolean; contactStatus?: string } = {}) {
  const ctx: TenantContext = { ...(await createTestWorkspace()), requestId: "req", role: "member" };
  const creatorId = await addIndexedCreator(db, { contacts: [{ kind: "email", value: "sana@example.com", trust: "unverified", source: "bio" }] });
  const k = await campaigns.create(ctx, { ...base, name: "Eid push" });
  await campaigns.addCreators(ctx, k.id, [creatorId]);
  const [c] = await ownerQuery<{ id: string }>(`select id from gcp.creator_contacts where creator_id = '${creatorId}'`);
  if (o.contactStatus) await ownerQuery(`update gcp.creator_contacts set status = '${o.contactStatus}' where creator_id = '${creatorId}'`);
  if (o.reveal !== false) await ownerQuery(`insert into wp.contact_reveals (workspace_id, creator_id, revealed_by) values ('${ctx.workspaceId}', '${creatorId}', '${ctx.userId}')`);
  return { ctx, creatorId, campaignId: k.id, contactId: c?.id ?? "" };
}
const email = (contactId: string) => ({ contactId, subject: "Eid collaboration", body: "Salaam! Would you like to work with us this Eid?", confirm: true as const });
const key = () => `send-${randomUUID()}`;
const webhook = (svc: ReturnType<typeof service>, id: string, type: string, messageId: string, at = new Date()) => {
  const raw = JSON.stringify({ type, created_at: at.toISOString(), data: { email_id: messageId } });
  return svc.handleWebhook(signEmailWebhook(SECRET, id, raw, at), raw);
};

describe("outreach email: who may send what", () => {
  it("is refused when the server has no provider, and when the plan does not include it", async () => {
    const s = await setup();
    await expect(service({ off: true }).send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ details: { reason: "outreach_email_unavailable" } });
    limit = 0; // Starter
    await expect(service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ code: "ENTITLEMENT_REQUIRED", details: { reason: "plan_feature", key: "outreach_emails" } });
    expect(provider.sent).toEqual([]);
  });

  it("needs a revealed email that is not known to be invalid, a creator in this campaign, and a campaign that is not archived", async () => {
    const hidden = await setup({ reveal: false });
    await expect(service().send(hidden.ctx, hidden.campaignId, hidden.creatorId, email(hidden.contactId), key())).rejects.toMatchObject({ details: { reason: "contact_not_revealed" } });
    const invalid = await setup({ contactStatus: "invalid" });
    await expect(service().send(invalid.ctx, invalid.campaignId, invalid.creatorId, email(invalid.contactId), key())).rejects.toMatchObject({ details: { reason: "contact_invalid" } });
    const s = await setup();
    const other = await addIndexedCreator(db);
    await expect(service().send(s.ctx, s.campaignId, other, email(s.contactId), key())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await campaigns.update(s.ctx, s.campaignId, { status: "archived" });
    await expect(service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ details: { reason: "campaign_archived" } });
    expect(provider.sent).toEqual([]);
  });

  it("never sends into another workspace's campaign, and lists only the workspace's own emails", async () => {
    const s = await setup();
    await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key());
    const outsider: TenantContext = { ...(await createTestWorkspace()), requestId: "req", role: "owner" };
    await expect(service().send(outsider, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service().list(outsider, s.campaignId)).toEqual([]);
    expect(await service().list(s.ctx, s.campaignId)).toHaveLength(1);
  });
});

describe("outreach email: sending and the allowance", () => {
  it("sends once per idempotency key, says accepted (not delivered) and includes an unsubscribe link", async () => {
    const s = await setup();
    const k = key();
    const first = await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), k);
    const again = await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), k);
    expect(first).toMatchObject({ status: "accepted", mode: "test", recipient: expect.stringContaining("***"), subject: "Eid collaboration" });
    expect(again.id).toBe(first.id);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]).toMatchObject({ to: "sana@example.com", sendId: first.id });
    expect(provider.sent[0]?.text).toMatch(/Would you like to work with us[\s\S]*https:\/\/app\.mushin\.test\/#\/unsubscribe\/[0-9a-f]{64}\.[0-9a-f]{32}/);
    expect((await service().usage(s.ctx)).used).toBe(1);
    // The address itself is never stored with the send.
    expect(JSON.stringify(await ownerQuery(`select * from wp.outreach_emails`))).not.toContain("sana@example.com");
  });

  it("holds the billing period's allowance under concurrent sends; a provider refusal frees its slot", async () => {
    limit = 3;
    const s = await setup();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.details?.reason === "plan_limit")).toBe(true);
    expect(await service().usage(s.ctx)).toMatchObject({ limit: 3, used: 3, mode: "test" });

    limit = 4;
    provider.failNext = "validation_error";
    expect(await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).toMatchObject({ status: "failed", failureReason: "validation_error" });
    expect((await service().usage(s.ctx)).used).toBe(3); // the failed send does not count
    expect(await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).toMatchObject({ status: "accepted" });
  });

  it(`limits one person to ${SENDS_PER_USER_PER_HOUR} sends an hour`, async () => {
    limit = null;
    const s = await setup();
    for (let i = 0; i < SENDS_PER_USER_PER_HOUR; i += 1) await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key());
    await expect(service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("outreach email: provider webhooks, suppression and unsubscribe", () => {
  it("applies signed events once, only forward; a bounce suppresses the address for every workspace", async () => {
    const s = await setup();
    const sent = await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key());
    const [row] = await ownerQuery<{ provider_message_id: string }>(`select provider_message_id from wp.outreach_emails where id = '${sent.id}'`);
    const msg = row?.provider_message_id ?? "";
    expect(await webhook(service(), "msg_1", "email.delivered", msg)).toBe("applied");
    expect(await webhook(service(), "msg_1", "email.delivered", msg)).toBe("duplicate"); // replayed delivery
    expect(await webhook(service(), "msg_2", "email.bounced", msg)).toBe("applied");
    expect(await webhook(service(), "msg_3", "email.delivered", msg)).toBe("applied"); // late, out of order
    expect((await service().list(s.ctx, s.campaignId))[0]?.status).toBe("bounced");
    expect(await webhook(service(), "msg_4", "email.opened", msg)).toBe("ignored");
    await expect(service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ details: { reason: "recipient_suppressed" } });
  });

  it("rejects unsigned, forged and stale webhooks", async () => {
    const raw = JSON.stringify({ type: "email.delivered", data: { email_id: "x" } });
    await expect(service().handleWebhook({}, raw)).rejects.toBeInstanceOf(WebhookSignatureError);
    const signed = signEmailWebhook(SECRET, "msg_9", raw, new Date());
    await expect(service().handleWebhook(signed, raw.replace("delivered", "bounced"))).rejects.toBeInstanceOf(WebhookSignatureError);
    const old = signEmailWebhook(SECRET, "msg_10", raw, new Date(Date.now() - 3_600_000));
    await expect(service().handleWebhook(old, raw)).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("unsubscribes through the signed link only", async () => {
    const s = await setup();
    await service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key());
    const link = provider.sent[0]?.text.match(/unsubscribe\/([0-9a-f]{64}\.[0-9a-f]{32})/)?.[1] ?? "";
    await expect(service().unsubscribe(`${link.slice(0, -1)}0`)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await service().unsubscribe(link);
    expect(await ownerQuery(`select reason from platform.email_suppressions`)).toEqual([{ reason: "unsubscribed" }]);
    await expect(service().send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ details: { reason: "recipient_suppressed" } });
  });
});

describe("outreach email: draft, preview, recipients and sender identity (2026-10-26)", () => {
  const svc = (o: { postal?: string | null; mode?: "test" | "resend" } = {}) => {
    const p = o.mode === "resend" ? Object.assign(new MockEmailProvider(), { mode: "resend" as const }) : provider;
    return createOutreachEmailService({ db, billing, provider: p as never, from: "Roster <outreach@roster.test>", postalAddress: o.postal === undefined ? "Roster, 1 Test Road, Lahore, Pakistan" : o.postal, encryptionKey: TEST_KEY, unsubscribeKey: Buffer.alloc(32, 7), appUrl: "https://app.mushin.test", webhookSecret: SECRET, logger: createLogger({ level: "silent" }) });
  };
  const namedCampaign = async () => {
    const s = await setup();
    await campaigns.update(s.ctx, s.campaignId, { client: "Shan Foods" });
    return s;
  };

  it("drafts from the real brand and campaign, prefills the revealed address, and never claims a deal is agreed", async () => {
    const s = await namedCampaign();
    const d = await svc().draft(s.ctx, s.campaignId, s.creatorId);
    expect(d.subject).toContain("Shan Foods");
    expect(d.subject).toContain("Eid push");
    expect(d.body).toContain("Nothing is agreed or confirmed yet");
    expect(d.recipients).toEqual([expect.objectContaining({ id: s.contactId, source: "creator_contact", value: "sana@example.com", status: "unverified" })]);
    expect(d.sender).toMatchObject({ fromAddress: "outreach@roster.test", postalAddress: "Roster, 1 Test Road, Lahore, Pakistan" });
    expect(d.sender.replyTo).toMatch(/@/);
    expect(d.profileLinks.length).toBeGreaterThan(0);
    // Without a reveal the address is not shown; the draft only says one exists.
    const hidden = await setup({ reveal: false });
    expect(await svc().draft(hidden.ctx, hidden.campaignId, hidden.creatorId)).toMatchObject({ recipients: [], revealNeeded: true });
  });

  it("sends exactly what the preview showed: transparent sender, replies to the person, postal address and opt-out", async () => {
    const s = await namedCampaign();
    const input = { contactId: s.contactId, subject: "Eid collaboration", body: "Salaam! Would you like to work with us?" };
    const p = await svc().preview(s.ctx, s.campaignId, s.creatorId, input);
    // The product is named MUSHIN; the configured sender address is used unchanged (owner instruction 2026-10-27).
    expect(p.from).toMatch(/^".+ via MUSHIN" <outreach@roster\.test>$/);
    expect(p.text).toContain("on behalf of Shan Foods through MUSHIN");
    expect(p.text).toContain("Roster, 1 Test Road, Lahore, Pakistan");
    expect(p.text).toContain("To stop receiving emails sent through MUSHIN: https://app.mushin.test/#/unsubscribe/");
    expect(p.warnings.join(" ")).toContain("has not been checked");
    expect(provider.sent).toEqual([]);
    await svc().send(s.ctx, s.campaignId, s.creatorId, { ...input, confirm: true }, key());
    expect(provider.sent).toEqual([expect.objectContaining({ from: p.from, replyTo: p.replyTo, to: "sana@example.com", subject: p.subject, text: p.text })]);
  });

  it("accepts an address the person enters, keeps it for that workspace only, and leaves the creator's contacts unchanged", async () => {
    const s = await namedCampaign();
    const before = await ownerQuery(`select id, status from gcp.creator_contacts where creator_id = '${s.creatorId}' order by id`);
    const sent = await svc().send(s.ctx, s.campaignId, s.creatorId, { manualEmail: "Agent@ShanFoods.pk", subject: "Hi", body: "Hello", confirm: true }, key());
    expect(sent.status).toBe("accepted");
    expect(provider.sent.at(-1)?.to).toBe("agent@shanfoods.pk");
    expect(await ownerQuery(`select id, status from gcp.creator_contacts where creator_id = '${s.creatorId}' order by id`)).toEqual(before);
    const typed = await ownerQuery<{ workspace_id: string; source: string; status: string }>(`select workspace_id, source, status from wp.workspace_contacts where creator_id = '${s.creatorId}'`);
    expect(typed).toEqual([{ workspace_id: s.ctx.workspaceId, source: "user_provided", status: "unverified" }]);
    expect((await ownerQuery<{ contact_source: string }>(`select contact_source from wp.outreach_emails where id = '${sent.id}'`))[0]?.contact_source).toBe("workspace_contact");
    // The draft now offers it, labelled as user-provided.
    expect((await svc().draft(s.ctx, s.campaignId, s.creatorId)).recipients).toContainEqual(expect.objectContaining({ source: "workspace_contact", value: "agent@shanfoods.pk", status: "user_provided" }));
    // Another workspace can neither see it nor use its id, even with the same creator in its own campaign.
    const other: TenantContext = { ...(await createTestWorkspace()), requestId: "req2", role: "member" };
    const k2 = await campaigns.create(other, { ...base, name: "Other" });
    await campaigns.addCreators(other, k2.id, [s.creatorId]);
    expect((await svc().draft(other, k2.id, s.creatorId)).recipients.filter((r) => r.source === "workspace_contact")).toEqual([]);
    const [wc] = await ownerQuery<{ id: string }>(`select id from wp.workspace_contacts where creator_id = '${s.creatorId}'`);
    await expect(svc().send(other, k2.id, s.creatorId, { contactId: wc?.id ?? "", subject: "Hi", body: "Hello", confirm: true }, key())).rejects.toMatchObject({ details: { reason: "contact_not_revealed" } });
  });

  it("refuses an unusable or suppressed entered address, and a send that names two recipients", async () => {
    const s = await namedCampaign();
    await expect(svc().send(s.ctx, s.campaignId, s.creatorId, { manualEmail: "logo@2x.png", subject: "Hi", body: "Hello", confirm: true }, key())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await ownerQuery(`insert into platform.email_suppressions (recipient_hash, reason) values (encode(sha256('gone@shanfoods.pk'::bytea), 'hex'), 'unsubscribed')`);
    await expect(svc().send(s.ctx, s.campaignId, s.creatorId, { manualEmail: "gone@shanfoods.pk", subject: "Hi", body: "Hello", confirm: true }, key())).rejects.toMatchObject({ details: { reason: "recipient_suppressed" } });
    expect((await svc().preview(s.ctx, s.campaignId, s.creatorId, { manualEmail: "gone@shanfoods.pk", subject: "Hi", body: "Hello" })).warnings[0]).toContain("will not email it");
    const { sendOutreachEmailSchema } = await import("@mushin/contracts");
    expect(sendOutreachEmailSchema.safeParse({ contactId: s.contactId, manualEmail: "a@b.org", subject: "x", body: "y", confirm: true }).success).toBe(false);
    expect(sendOutreachEmailSchema.safeParse({ subject: "x", body: "y", confirm: true }).success).toBe(false);
    expect(provider.sent).toEqual([]);
  });

  // Regression (browser break-it run, 2026-10-27): the composer guessed "can send" from warning text and silently did
  // nothing in test mode without a postal address. The server now says whether the previewed email is sendable.
  it("says in the preview whether this exact email can be sent, and why not", async () => {
    const s = await namedCampaign();
    const input = { contactId: s.contactId, subject: "Hi", body: "Hello" };
    expect(await svc({ postal: null }).preview(s.ctx, s.campaignId, s.creatorId, input)).toMatchObject({ sendable: true, blockedReason: null });
    expect(await svc({ mode: "resend", postal: null }).preview(s.ctx, s.campaignId, s.creatorId, input)).toMatchObject({ sendable: false, blockedReason: expect.stringContaining("postal address") });
    await ownerQuery(`insert into platform.email_suppressions (recipient_hash, reason) values (encode(sha256('blocked@shanfoods.pk'::bytea), 'hex'), 'complained')`);
    expect(await svc().preview(s.ctx, s.campaignId, s.creatorId, { manualEmail: "blocked@shanfoods.pk", subject: "Hi", body: "Hello" })).toMatchObject({ sendable: false });
  });

  it("refuses a real send without a configured postal address", async () => {
    const s = await namedCampaign();
    await expect(svc({ mode: "resend", postal: null }).send(s.ctx, s.campaignId, s.creatorId, email(s.contactId), key())).rejects.toMatchObject({ details: { reason: "outreach_email_unavailable" } });
  });
});
