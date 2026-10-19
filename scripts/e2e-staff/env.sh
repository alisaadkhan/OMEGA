# Staff and team E2E (worktree MUSHIN-team): its own database, ports and sign-in stub, so it never shares state with
# the customer harness (scripts/e2e-customer: mushin_e2e, :4000/:4999/:5173).
export DATABASE_URL=postgres://postgres@localhost:54330/mushin_e2e_team
export DIRECT_URL=postgres://postgres@localhost:54330/mushin_e2e_team
export DATABASE_SSL_CA_FILE=
export NODE_ENV=development
export PORT=4100
# The staff console (and so WebAuthn's origin) is served by this harness's Vite on :5174.
export APP_URL=http://localhost:5174
export JWKS_URI=http://localhost:4998/jwks.json
export JWT_ISSUER=http://localhost:4998/auth/v1
export JWT_AUDIENCE=authenticated
# No metered providers: Apify, Serper and both LLMs blank; audience estimates off.
export APIFY_TOKEN=
export SERPER_API_KEY=
export GROQ_API_KEY=
export OLLAMA_API_KEY=
export AUDIENCE_SOURCES=
export MEILISEARCH_INDEX_PREFIX=team_
export RATE_LIMIT_MAX_REQUESTS=2000
export RATE_LIMIT_STORE=memory
# Fixed, non-secret values so a run never depends on a developer's .env (audit OPS-02).
export SUPABASE_URL=http://localhost:4998
export DATA_ENCRYPTION_KEY="$(node -p 'Buffer.from("mushin-e2e-fixed-key-not-secret!").toString("base64")')" # 32 bytes, readable on purpose
export STAFF_JWT_SECRET=e2e-staff-jwt-secret-fixed-value-not-a-secret
export MOCK_PADDLE_WEBHOOK_SECRET=e2e-mock-paddle-webhook-secret-not-a-secret
export PADDLE_API_KEY=
export PADDLE_CLIENT_TOKEN=
export PADDLE_WEBHOOK_SECRET=
export ALERT_WEBHOOK_URL=
# Test harness only: workspaces get the trial at first sign-in so journeys have credits. Production default is
# TRIAL_ACTIVATION=approval (staff approve each trial); that path is covered by trials.int.test.ts and the trial checks.
export TRIAL_ACTIVATION=automatic
