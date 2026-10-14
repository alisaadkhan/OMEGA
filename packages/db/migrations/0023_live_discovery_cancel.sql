-- JOB-003: a customer can ask a running live discovery to stop. The API only records the request (the column below,
-- through the existing tenant policy); the worker stops at its next safe point, charges only creators already
-- delivered (the partial-run rule) and releases the rest of the reservation. Settlement stays with the worker.
alter table wp.discovery_jobs add column cancel_requested_at timestamptz;
grant update (cancel_requested_at) on wp.discovery_jobs to mushin_app;
