-- Per-job Campaign Fit evidence; this is deliberately separate from catalog fit.
alter table wp.discovery_results
  add column campaign_fit jsonb;

alter table wp.discovery_results
  add constraint discovery_results_campaign_fit_shape check (
    campaign_fit is null or jsonb_typeof(campaign_fit) = 'object'
  );
