-- Postgres review 2026-11-15 (owner approved for the live sync): gcp.creator_attribute_evidence.payload_id references
-- platform.raw_payloads (on delete set null) with no index, so every payload the retention purge deletes scans the whole
-- evidence table (a rolled-back delete of 20 payloads: 32 ms without, 4.5 ms with this index on 9,117 evidence rows).
-- Partial: most evidence rows carry no payload.
create index if not exists creator_attribute_evidence_payload_idx
  on gcp.creator_attribute_evidence (payload_id)
  where payload_id is not null;
