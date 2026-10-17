# G — Current and target architecture, data, integration and deployment diagrams

Legend used in every diagram: solid = **verified present** in code at `1398cee`; dashed or labelled **(proposed)** =
not built. No diagram draws a deployed component, because nothing is deployed.

## 1. Layers MUSHIN actually needs

| Layer / cross-cutting concern | Why it exists | Implemented where | State |
|---|---|---|---|
| Presentation (SPA) | Customer + staff UI | `frontend/` React/Vite, hash router | Built; staff UI in same bundle |
| API edge (HTTP, CORS, headers, rate limits, request ids) | One trust boundary for browsers | `apps/api/src/app.ts`, `http/*`, `rate-limit/*` | Built; trustProxy missing (SEC-05) |
| Identity & tenancy | Who is calling, which workspace | `auth/*`, `modules/identity` + RLS | Built; SEC-03, SEC-04 |
| Domain services | Search, discovery, CRM, billing, support, staff ops | `apps/api/src/modules/*` | Built |
| Durable work (outbox → queue → worker) | Long, retryable, paid steps outside requests | `platform.outbox`, pg-boss, `apps/worker` | Built; SRCH-04 |
| Provider adapters (spend-guarded) | Isolate Serper, Apify, YouTube, LLM, Paddle, storage | `packages/integrations` | Built; per-process guards (SRCH-05) |
| Persistence (PostgreSQL, RLS, append-only ledgers) | System of record | `packages/db/migrations` 0001–0037 | Built |
| Object storage | Raw payload archive, avatars | Supabase Storage adapter | Built; not backed up (OPS-04) |
| Search index (optional) | Meilisearch adapter | `integrations/search` | Optional; PostgreSQL default |
| Billing & entitlements | Credits, plans, payments | `modules/billing` | Built (mock payments) |
| Privacy & retention | Erasure, suppression, YouTube expiry, purges | `creators/erasure`, schedules | Built |
| Observability | Logs, metrics, alerts | pino logs + staff alert thresholds | **Partial: no delivery** (OPS-03) |
| Delivery / operations | CI, deploy, backup, DR | `ci.yml` (never run) | **Missing** |

## 2. Current architecture (verified)

```mermaid
flowchart LR
  subgraph Browser
    SPA[React + Vite SPA<br/>customer + staff console]
  end
  subgraph Local_dev_only["Developer machine (nothing deployed)"]
    API[Fastify API<br/>116 routes /v1 /admin/v1 /webhooks/paddle]
    W[Worker<br/>outbox relay + pg-boss 9 queues + 15 schedules]
    PG[("PostgreSQL<br/>wp / gcp / platform / staff")]
    MS[("Meilisearch<br/>optional")]
  end
  SA[Supabase Auth<br/>JWKS only — real sign-in never exercised]
  ST[("Supabase Storage<br/>raw-payloads, avatars")]
  SER[Serper]:::paid
  APF[Apify actors]:::paid
  YT[YouTube Data API]
  LLM[Groq → Ollama Cloud<br/>USD 5 cap]:::paid
  UP[("Upstash Redis<br/>auto-used if vars set")]
  PAD[Paddle — mock in dev]
  SPA -->|Bearer JWT + X-Workspace-Id| API
  SPA -->|sign-in| SA
  API -->|JWKS verify| SA
  API --> PG
  API -. optional .-> MS
  API -. if configured .-> UP
  API -->|outbox rows| PG
  PG -->|LISTEN mushin_outbox| W
  W --> PG
  W --> SER & APF & YT & LLM
  W --> ST
  W -. dual-write .-> MS
  PAD -->|signed webhook| API
  classDef paid fill:#fff3cd,stroke:#b58900
```

## 3. Recommended target architecture (proposed — owner decision D-01)

```mermaid
flowchart LR
  U[Browser] --> CDN["Static host + CDN<br/>(proposed) CSP, immutable /assets, no-cache index.html"]
  U -->|/api| LB["Host proxy / TLS<br/>(proposed) trusted CIDRs → trustProxy"]
  LB --> API[API container ×1–2<br/>Fastify, stateless]
  API --> PGB[Supabase transaction pooler 6543]
  W["Worker container ×1<br/>pg-boss + relay (session pooler 5432)"] --> PGS[Supabase session pooler]
  PGB --> DB[("Supabase PostgreSQL<br/>daily backups or PITR (owner)")]
  PGS --> DB
  API --> AUTH["Supabase Auth<br/>custom SMTP via Resend (proposed)"]
  W --> STO[("Supabase Storage<br/>+ separate backup (proposed)")]
  W --> PROV["Serper / Apify (maxTotalChargeUsd, run ids persisted) / YouTube / LLM"]
  PAY["Paddle (after seller confirmation)"] -->|signed webhook| API
  API & W --> OBS["Error tracking + uptime + alert channel (proposed)"]
  REM["Upstash, Meilisearch Cloud: removed (proposed)"]:::gone
  classDef gone fill:#eee,stroke:#999,stroke-dasharray: 4 3
```

## 4. Search pipeline sequence (Brain 1 and Brain 2)

```mermaid
sequenceDiagram
  autonumber
  participant UI as SPA
  participant API
  participant DB as PostgreSQL
  participant Q as Outbox/pg-boss
  participant WK as Worker
  participant P as Serper/Apify/YouTube/LLM
  Note over UI,DB: Brain 1 — catalogue
  UI->>API: POST /v1/search {text, filters, confirmedCost}
  API->>API: understandQuery (deterministic)
  API->>DB: FTS + aliases + eligibility (elig-1) + filters
  DB-->>API: ranked ids (≤ candidatePool)
  API->>DB: chargeCatalogSearch (50 once / 30 min, also on 0 results)
  API-->>UI: page + matchedOn + nextCursor
  Note over UI,P: Brain 2 — Live Discovery
  UI->>API: POST /v1/discovery/estimates
  API->>API: validateLiveBrief (topic + anchor, ≥ 2.5)
  API->>DB: insert estimate (prices, max, 15 min)
  API-->>UI: maxCredits, minimumCredits, expiresAt
  UI->>API: POST /v1/discovery/jobs {estimateId}
  API->>DB: TX: lock estimate, re-validate, reserve max, insert job, consume, outbox
  DB-->>Q: NOTIFY
  Q->>WK: discovery.live_requested
  loop rounds 1..3 until pool ≥ 8
    WK->>P: Serper site: queries (15-min cache)
  end
  WK->>P: LLM relevance (ambiguous only, batches of 12)
  WK->>DB: known creators → Campaign Fit → free results
  loop waves within cost cap & 20-min deadline
    WK->>P: Apify / YouTube profile batch
    WK->>DB: archive raw → enrich → Fit + elig-1 → result (+10 if new)
  end
  WK->>DB: settle once (commitPartial) → job terminal outcome
  UI->>API: poll job / results
```

## 5. Search failure and retry flow

```mermaid
flowchart TD
  S[Step fails] --> T{ProviderError?}
  T -- spend_cap / quota / not_configured --> NR[Not retryable]
  T -- provider 5xx/429/timeout --> R{attempts < 3?}
  T -- other error --> R
  R -- yes --> RQ[throw → pg-boss retry with backoff<br/>archived profiles reused]
  RQ --> S0[Next attempt resumes from DB state]
  R -- no --> NR
  NR --> V{visible results > 0?}
  V -- yes --> PART[outcome partial<br/>charge base + delivered new]
  V -- no --> FAIL[outcome failed<br/>release reservation, charge 0]
  X[Worker crash during Apify wait] -.->|"run id not persisted (SRCH-04)"| ORPH[Apify run keeps charging<br/>retry starts a new run]
  SW[discovery_sweep every 5 min] -->|job stuck > stuck_job_minutes| FAIL
  RA[release_abandoned every minute] -->|reservation not extended| REL[expired + ledger release]
```

## 6. Creator data lifecycle (ingestion → enrichment → refresh → deletion)

```mermaid
stateDiagram-v2
  [*] --> Candidate: Serper link / pasted URL
  Candidate --> Rejected: business cue, suppressed, irrelevant, cap
  Candidate --> Fetched: Apify / YouTube API (raw archived, private bucket)
  Fetched --> Unavailable: private / missing / unusable
  Fetched --> Persisted: standardise, signals, AI assessment, minor check
  Persisted --> Eligible: ≥10k followers, count ≤ 90 d old, URL valid
  Persisted --> Ineligible: below / stale / unknown
  Eligible --> Ineligible: count ages past 90 d (no scheduled refresh — SRCH-02)
  Eligible --> YTCleared: YouTube API data not refreshed in 30 d
  YTCleared --> Ineligible
  Ineligible --> Eligible: paid refresh / Live Discovery re-find
  Persisted --> Hidden: removal request received
  Hidden --> Erased: staff/owner approves → tombstone + URL hash suppression
  Hidden --> Persisted: request rejected
  Erased --> [*]
  note right of Fetched: raw payloads purged after raw_retention_days (≤ 30 for YouTube)
```

## 7. ERD — actual database (selected; 37 migrations)

```mermaid
erDiagram
  WP_USERS ||--o{ WP_WORKSPACE_MEMBERS : has
  WP_WORKSPACES ||--o{ WP_WORKSPACE_MEMBERS : has
  WP_WORKSPACES ||--o{ WP_WORKSPACE_INVITATIONS : issues
  WP_WORKSPACES ||--|| WP_SUBSCRIPTIONS : "has (cascade!)"
  WP_WORKSPACES ||--o{ WP_CREDIT_LOTS : "cascade!"
  WP_WORKSPACES ||--o{ WP_CREDIT_RESERVATIONS : holds
  WP_WORKSPACES ||--o{ WP_CREDIT_LEDGER : "append-only (cascade!)"
  WP_CREDIT_LOTS ||--o{ WP_CREDIT_LEDGER : lot_id
  WP_CREDIT_RESERVATIONS ||--o{ WP_CREDIT_LEDGER : reservation_id
  WP_WORKSPACES ||--o{ WP_PAYMENTS : "cascade!"
  WP_WORKSPACES ||--o{ WP_DISCOVERY_ESTIMATES : quotes
  WP_DISCOVERY_ESTIMATES ||--o| WP_DISCOVERY_JOBS : consumed_by
  WP_DISCOVERY_JOBS ||--o{ WP_DISCOVERY_RESULTS : delivers
  WP_DISCOVERY_JOBS ||--o{ WP_DISCOVERY_CANDIDATES : trail
  WP_WORKSPACES ||--o{ WP_LISTS : owns
  WP_LISTS ||--o{ WP_LIST_MEMBERS : contains
  WP_WORKSPACES ||--o{ WP_CAMPAIGNS : owns
  WP_CAMPAIGNS ||--o{ WP_CAMPAIGN_CREATORS : pipeline
  WP_CAMPAIGN_CREATORS ||--o{ WP_OUTREACH_EVENTS : "append-only log"
  WP_WORKSPACES ||--o{ WP_CONTACT_REVEALS : reveals
  WP_WORKSPACES ||--o{ WP_CATALOG_SEARCH_CHARGES : charges
  WP_WORKSPACES ||--o{ WP_SUPPORT_TICKETS : opens
  GCP_CREATORS ||--o{ GCP_CREATOR_PROFILES : "one per platform"
  GCP_CREATORS ||--o{ GCP_CREATOR_CONTACTS : "encrypted, no app grant"
  GCP_CREATOR_PROFILES ||--o{ GCP_ENRICHMENT_SNAPSHOTS : "append-only"
  GCP_CREATORS ||--|| GCP_CREATOR_SEARCH_DOCUMENTS : projection
  GCP_CREATORS ||--o{ WP_DISCOVERY_RESULTS : referenced
  GCP_CREATORS ||--o{ WP_LIST_MEMBERS : referenced
  STAFF_STAFF_USERS ||--o{ STAFF_SESSIONS : refresh_families
  STAFF_STAFF_USERS ||--o{ STAFF_WEBAUTHN_CREDENTIALS : keys
  STAFF_STAFF_USERS ||--o{ STAFF_APPROVALS : requests_decides
  STAFF_STAFF_USERS ||--o{ STAFF_AUDIT_LOG : "insert-only grant"
```

Platform tables not drawn: `platform.outbox`, `provider_calls`, `provider_controls`, `serper_cache`,
`rate_limit_counters` (unlogged), `billing_schedule`, `webhook_events (provider, provider_event_id unique)`,
`idempotency_keys`, plans/packs/costs/settings, `gcp.creator_suppressions`. The pack's `database/*.sql` is a **proposed**
reference and is not drawn here.

## 8. Credit reservation, settlement and refund

```mermaid
sequenceDiagram
  participant API
  participant ENG as Credit engine (advisory lock per workspace)
  participant DB
  API->>ENG: reserveAmount(max, confirmedCost)
  ENG->>DB: balance = Σ lots valid − Σ held
  alt insufficient / price changed / no plan
    ENG-->>API: 402/409, nothing written
  else ok
    ENG->>DB: reservation(held, ttl 15 min) + ledger "reserve" (RLS: amount ∈ approved price set)
  end
  loop while running
    API->>ENG: extend(reservation)
  end
  API->>ENG: commitPartial(charge ≤ max)
  ENG->>DB: allocate soonest-expiring lots → ledger "spend" rows, lot.remaining −
  ENG->>DB: ledger "release" (max − charge), reservation committed|released
  Note over ENG,DB: release_abandoned job expires holds that stop renewing, settlement is idempotent (status check under lock)
  Note over DB: money refunds (Paddle) not implemented beyond webhook handling — BIL-03
```

## 9. Workspace authorisation and data isolation

```mermaid
flowchart TB
  R[Request] --> J{"Bearer JWT valid?<br/>iss/aud/RS256|ES256, uuid sub, email"}
  J -- no --> E401[401]
  J -- yes --> L{user rate limit}
  L -- exceeded --> E429[429]
  L --> M{X-Workspace-Id is a membership?}
  M -- yes --> CTX[TenantContext ws, role]
  M -- no / absent --> FB[falls back to oldest membership — SEC-04]
  FB --> CTX
  CTX --> SVC[Service role check owner/admin/member]
  SVC --> TX["withTenant: SET LOCAL ROLE mushin_app;<br/>set_config(app.workspace_id)"]
  TX --> RLS[("28/28 wp tables FORCE RLS<br/>gcp read-only, no contacts grant")]
  STF[/admin/v1/] --> SG{"staff HS256 token + isActive(role)"}
  SG --> HK{action needs hardware key?}
  HK -- amr has hwk (claim only — SEC-02) --> OK[allowed + audited]
  HK -- no --> E403[403]
```

## 10. Account deletion and workspace export

```mermaid
flowchart TD
  EX[GET /v1/workspace/export<br/>owner or admin] --> RLSR["read 17 wp tables via RLS<br/>≤ 50k rows each (DATA-03)<br/>no contact values, no staff notes"] --> JSON[attachment JSON, no-store]
  DW[POST /v1/workspace/delete<br/>owner + typed name] --> CK{active/past_due subscription,<br/>queued/running job or held credits?}
  CK -- yes --> REF[409 with reason]
  CK -- no --> ER[erase_workspace: delete 19 wp tables' rows,<br/>idempotency keys, unpublished outbox;<br/>status=deleted] --> KEEP[kept: subscriptions, payments,<br/>lots, ledger, staff audit]
  DA[POST /v1/me/delete<br/>typed email] --> C2{owns workspace with other members<br/>or paid subscription?}
  C2 -- yes --> REF2[409 transfer/cancel first]
  C2 -- no --> DEL[erase owned workspaces → remove memberships →<br/>scrub profile, status=deleted]
  DEL --> IDP["Supabase Auth user NOT deleted (SEC-13)"]
  DEL --> BLOCK[sign-in again → 403 account_deleted]
```

## 11. Deployment, queue, database and provider dependencies (target; proposed)

```mermaid
flowchart LR
  subgraph Customers
    B["Browsers (Pakistan)"]
  end
  B --> PAGES["Static host (proposed)"]
  B --> APIH["API host region near PK (proposed)"]
  APIH -->|6543 tx pooler| SB[("Supabase project region near PK<br/>DB + Auth + Storage")]
  WH["Worker host (proposed)"] -->|5432 session| SB
  WH --> SER[Serper] & APF[Apify] & YT[YouTube API] & GQ[Groq/Ollama]
  SB -->|SMTP| RS["Resend (proposed)"]
  PDL["Paddle (proposed)"] --> APIH
  APIH & WH --> MON["Error tracking/uptime (proposed)"]
  SB --> BK[("Backups: daily 7 d or PITR (owner)")]
  SB -.-> STB[("Storage object backup (proposed)")]
  classDef spof fill:#fde2e2,stroke:#c00
  class SB spof
```

Single points of failure: the Supabase project (DB + Auth + Storage), the single worker (spend guards assume one), and
Serper (only discovery source besides YouTube-native search). External failure of Apify/LLM degrades Live Discovery
gracefully (refund paths verified in tests); a Supabase outage stops everything.
