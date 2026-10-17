import type { Sql } from "postgres";
import { decryptSecret, encryptedKeyId, encryptSecret, keyId } from "@mushin/core";

/**
 * Re-encryption for a DATA_ENCRYPTION_KEY rotation (audit SEC-09). Every column sealed with the key is listed here;
 * a new encrypted column must be added, or a rotation would leave it unreadable (key-rotation.int checks the schema).
 */
export const ENCRYPTED_COLUMNS = [
  { table: "gcp.creator_contacts", column: "value_encrypted" },
  { table: "gcp.removal_requests", column: "requester_email_encrypted" },
  { table: "staff.staff_users", column: "totp_secret_encrypted" },
] as const;

export type ColumnReport = { table: string; column: string; rows: number; byKey: Record<string, number>; undecryptable: number; reencrypted: number };
export type RotationReport = { newKeyId: string; apply: boolean; columns: ColumnReport[] };

/**
 * Checks every encrypted value against the key ring (new key + previous keys). With `apply`, re-encrypts every value
 * not yet sealed with the new key, in batches, each row updated only if unchanged since it was read. Nothing is written
 * unless every value in every column decrypts. Values are never returned or logged; reports hold counts and key ids.
 * Run with the API and worker stopped (they hold only one key).
 */
export async function rotateEncryptionKey(sql: Sql, o: { newKey: Buffer; previousKeys: Buffer[]; apply: boolean; batchSize?: number }): Promise<RotationReport> {
  const ring = [o.newKey, ...o.previousKeys];
  const newKeyId = keyId(o.newKey);
  const columns: ColumnReport[] = [];
  for (const c of ENCRYPTED_COLUMNS) {
    const rows = await sql.unsafe<{ id: string; v: string }[]>(`select id::text as id, ${c.column} as v from ${c.table} where ${c.column} is not null`);
    const report: ColumnReport = { table: c.table, column: c.column, rows: rows.length, byKey: {}, undecryptable: 0, reencrypted: 0 };
    for (const r of rows) {
      const kid = encryptedKeyId(r.v) ?? "v1 (no id)";
      report.byKey[kid] = (report.byKey[kid] ?? 0) + 1;
      try {
        decryptSecret(r.v, ring);
      } catch {
        report.undecryptable += 1;
      }
    }
    columns.push(report);
  }
  const blocked = columns.some((c) => c.undecryptable > 0);
  if (!o.apply || blocked) return { newKeyId, apply: o.apply && !blocked, columns };

  const size = o.batchSize ?? 500;
  for (const [i, c] of ENCRYPTED_COLUMNS.entries()) {
    const report = columns[i];
    if (!report) continue;
    for (;;) {
      const done = await sql.begin(async (tx) => {
        const batch = await tx.unsafe<{ id: string; v: string }[]>(
          `select id::text as id, ${c.column} as v from ${c.table} where ${c.column} is not null and ${c.column} not like $1 order by id limit ${size} for update`,
          [`v2.${newKeyId}.%`],
        );
        for (const r of batch) {
          const fresh = encryptSecret(decryptSecret(r.v, ring), o.newKey);
          const updated = await tx.unsafe(`update ${c.table} set ${c.column} = $1 where id = $2::uuid and ${c.column} = $3`, [fresh, r.id, r.v]);
          report.reencrypted += updated.count;
        }
        return batch.length < size;
      });
      if (done) break;
    }
  }
  // Proof: every value now opens with the new key alone.
  for (const c of columns) {
    const rows = await sql.unsafe<{ v: string }[]>(`select ${c.column} as v from ${c.table} where ${c.column} is not null`);
    c.byKey = {};
    for (const r of rows) {
      decryptSecret(r.v, o.newKey);
      const kid = encryptedKeyId(r.v) ?? "v1 (no id)";
      c.byKey[kid] = (c.byKey[kid] ?? 0) + 1;
    }
  }
  return { newKeyId, apply: true, columns };
}
