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
# In-memory rate limiter (reset with each run); no remote Upstash calls during E2E.
export UPSTASH_REDIS_REST_URL=
export UPSTASH_REDIS_REST_TOKEN=
# Outreach email in test mode: a mock provider records sends; nothing is delivered (never allowed in production).
export OUTREACH_EMAIL_MODE=test
