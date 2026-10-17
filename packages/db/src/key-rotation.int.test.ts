import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, keyId } from "@mushin/core";
import { ENCRYPTED_COLUMNS, rotateEncryptionKey } from "./key-rotation";
import { ownerQuery, resetTables } from "./testing";

const sql = postgres(process.env["TEST_DATABASE_URL"] ?? "", { max: 2, prepare: false, onnotice: () => {} });
beforeEach(resetTables);
afterAll(() => sql.end({ timeout: 5 }));

const oldKey = Buffer.alloc(32, 4);
const newKey = Buffer.alloc(32, 5);

async function seed(contactValues: string[]) {
  const creator = randomUUID();
  await ownerQuery(`insert into gcp.creators (id, display_name, primary_handle, primary_platform) values ('${creator}', 'C', 'c_${creator.slice(0, 6)}', 'instagram')`);
  for (const [i, v] of contactValues.entries()) {
    await ownerQuery(`insert into gcp.creator_contacts (creator_id, kind, value_encrypted, value_hash, masked, source)
      values ('${creator}', 'email', '${v}', 'h${i}-${creator}', 'a***@e***.com', 'bio')`);
  }
  await ownerQuery(`insert into staff.staff_users (email, name, role, password_hash, totp_secret_encrypted) values ('s-${creator.slice(0, 6)}@mushin.pk', 'S', 'support', 'x', '${encryptSecret("TOTPSECRET", oldKey)}')`);
}
const contacts = () => ownerQuery<{ v: string }>(`select value_encrypted v from gcp.creator_contacts order by value_hash`);

describe("encryption key rotation (audit SEC-09)", () => {
  it("covers every encrypted column in the schema", async () => {
    const cols = await ownerQuery<{ c: string }>(`select table_schema || '.' || table_name || '.' || column_name c from information_schema.columns
      where table_schema in ('wp', 'gcp', 'staff', 'platform') and column_name like '%encrypted%' order by 1`);
    expect(cols.map((r) => r.c)).toEqual(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`).sort());
  });

  it("a dry run reports counts per key and writes nothing; apply re-encrypts everything under the new key", async () => {
    await seed([encryptSecret("a@example.com", oldKey), encryptSecret("b@example.com", oldKey)]);
    const before = await contacts();
    const dry = await rotateEncryptionKey(sql, { newKey, previousKeys: [oldKey], apply: false });
    expect(dry.columns.find((c) => c.table === "gcp.creator_contacts")).toMatchObject({ rows: 2, byKey: { [keyId(oldKey)]: 2 }, undecryptable: 0, reencrypted: 0 });
    expect(await contacts()).toEqual(before);

    const done = await rotateEncryptionKey(sql, { newKey, previousKeys: [oldKey], apply: true, batchSize: 1 });
    expect(done.columns.find((c) => c.table === "gcp.creator_contacts")).toMatchObject({ reencrypted: 2, byKey: { [keyId(newKey)]: 2 } });
    expect(done.columns.find((c) => c.table === "staff.staff_users")).toMatchObject({ reencrypted: 1, byKey: { [keyId(newKey)]: 1 } });
    expect((await contacts()).map((r) => decryptSecret(r.v, newKey))).toEqual(["a@example.com", "b@example.com"]);
    const first = (await contacts())[0]?.v ?? "";
    expect(() => decryptSecret(first, oldKey)).toThrow();
    // Running it again changes nothing.
    expect((await rotateEncryptionKey(sql, { newKey, previousKeys: [oldKey], apply: true })).columns.every((c) => c.reencrypted === 0)).toBe(true);
  });

  it("refuses to write anything while one value cannot be decrypted", async () => {
    await seed([encryptSecret("a@example.com", oldKey), encryptSecret("lost@example.com", Buffer.alloc(32, 6))]);
    const before = await contacts();
    const out = await rotateEncryptionKey(sql, { newKey, previousKeys: [oldKey], apply: true });
    expect(out.apply).toBe(false);
    expect(out.columns.find((c) => c.table === "gcp.creator_contacts")?.undecryptable).toBe(1);
    expect(await contacts()).toEqual(before);
  });
});
