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
export UPSTASH_REDIS_REST_URL=
export UPSTASH_REDIS_REST_TOKEN=
