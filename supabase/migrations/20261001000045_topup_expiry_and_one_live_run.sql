-- Audit BIL-04 and BIL-06 (2026-10-17).

-- BIL-04: 0030 forbade a missing expiry on lots that are not top-ups, but nothing stopped a top-up from being given one.
-- Top-ups never expire (owner decision 2026-10-14), so a top-up with credits left must have no expiry. Top-ups that
-- expired under the old 12-month rule keep their dates; the exemption for spent lots lets the expiry job zero them.
alter table wp.credit_lots add constraint credit_lots_topup_never_expires
  check (source <> 'topup' or expires_at is null or remaining = 0) not valid;
-- Checked against existing rows too wherever no unexpired-but-dated top-up remains (it holds for every new row anyway).
do $$
begin
  if not exists (select 1 from wp.credit_lots where source = 'topup' and expires_at is not null and remaining > 0) then
    alter table wp.credit_lots validate constraint credit_lots_topup_never_expires;
  end if;
end $$;

-- BIL-06: one open Live Discovery run per workspace (pack 08 §3). The 0012 index allowed one per brief, so a workspace
-- could run several briefs at once and spend its balance and the provider budget in parallel. A second run waits until
-- the first finishes; the API answers with the open run.
drop index wp.discovery_jobs_one_open_live;
create unique index discovery_jobs_one_open_live_per_workspace on wp.discovery_jobs (workspace_id)
  where kind = 'live' and status in ('queued', 'running');
