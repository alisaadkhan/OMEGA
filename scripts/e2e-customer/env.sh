# Customer E2E runs: isolated database mushin_e2e (reset from mushin_e2e_template before every run).
export DATABASE_URL=postgres://postgres@localhost:54330/mushin_e2e
export DIRECT_URL=postgres://postgres@localhost:54330/mushin_e2e
export DATABASE_SSL_CA_FILE=
export NODE_ENV=development
export PORT=4000
export JWKS_URI=http://localhost:4999/jwks.json
export JWT_ISSUER=http://localhost:4999/auth/v1
export JWT_AUDIENCE=authenticated
# No metered providers: Apify, Serper and both LLMs blank; audience estimates off.
export APIFY_TOKEN=
export SERPER_API_KEY=
export GROQ_API_KEY=
export OLLAMA_API_KEY=
export AUDIENCE_SOURCES=
# Own Meilisearch index prefix so mushin_local's dev_ index is untouched.
export MEILISEARCH_INDEX_PREFIX=e2e_
# Automation issues requests far faster than a person; production limits are unchanged (finding recorded).
export RATE_LIMIT_MAX_REQUESTS=2000
# Outreach email in test mode: a mock provider records sends; nothing is delivered (never allowed in production).
export OUTREACH_EMAIL_MODE=test
# Supabase Auth admin lookups go to the auth stub (trusted email verification, audit SEC-03); a fixed test key, never a real one.
export SUPABASE_URL=http://localhost:4999
export SUPABASE_SERVICE_ROLE_KEY=e2e-service-key-not-a-secret
# Fixed, non-secret values so a run never depends on a developer's .env (audit OPS-02): the synthetic template's contact
# details are encrypted with this key (build-template.sh), and the mock payment provider is always used.
export APP_URL=http://localhost:5173
export DATA_ENCRYPTION_KEY="$(node -p 'Buffer.from("mushin-e2e-fixed-key-not-secret!").toString("base64")')" # 32 bytes, readable on purpose
export STAFF_JWT_SECRET=e2e-staff-jwt-secret-fixed-value-not-a-secret
export MOCK_PADDLE_WEBHOOK_SECRET=e2e-mock-paddle-webhook-secret-not-a-secret
export PADDLE_API_KEY=
export PADDLE_CLIENT_TOKEN=
export PADDLE_WEBHOOK_SECRET=
export ALERT_WEBHOOK_URL=
# The database every run starts from: built from migrations + the synthetic catalogue (build-template.sh).
export E2E_TEMPLATE="${E2E_TEMPLATE:-mushin_e2e_synthetic_template}"
# Test harness only: workspaces get the trial at first sign-in so journeys have credits. Production default is
# TRIAL_ACTIVATION=approval (staff approve each trial); that path is covered by trials.int.test.ts and the trial checks.
export TRIAL_ACTIVATION=automatic
