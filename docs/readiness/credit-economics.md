# Credit economics: price versus measured provider cost

Date: 2026-10-14. Prices: owner pricing in migration `0027_owner_pricing.sql`. Costs: real provider calls recorded in
`platform.provider_calls` and the 2026-10-13 live evaluation (`docs/superpowers/specs/2026-10-09-live-discovery-erasure-design.md`
§19–21). No provider was called for this analysis.

## Rule tested

Owner rule: the customer price of an action must be at least **3× its direct provider cost**. It is measured against the
lowest revenue per credit, **Scale billed yearly: USD 852 ÷ 12 ÷ 35,000 = USD 0.002029 per credit** (plan charge prices
in `platform.plans`). Paddle's fee is not deducted; if it is 5% + USD 0.50 per transaction (unverified), revenue per credit
falls to about USD 0.00193 and every limit below shrinks by about 5%.

| Plan (credits / month) | USD per credit, monthly | USD per credit, yearly |
|---|---|---|
| Starter (2,500) | 0.007200 | 0.005600 |
| Growth (12,000) | 0.003833 | 0.003250 |
| Scale (35,000) | 0.002543 | **0.002029** |

## Direct cost per action (measured)

| Action | Price (credits) | Revenue at USD 0.002029 | Max cost for 3× | Measured direct cost | Result |
|---|---|---|---|---|---|
| Catalogue search | 50 | 0.1015 | 0.0338 | ≈ 0 (PostgreSQL); optional AI reading ≈ 0.00006 per query (`search_interpret`, 79 Groq calls cost USD 0.0046) | Passes |
| Contact reveal | 5 | 0.0101 | 0.0034 | 0 (stored data) | Passes |
| Refresh / add by link, Instagram or YouTube | 50 | 0.1015 | 0.0338 | Instagram profile USD 0.0026 (spec §19) + assessment ≈ 0.0002; YouTube USD 0 + assessment | Passes |
| Refresh / add by link, TikTok | 50 | 0.1015 | 0.0338 | USD 0.018 for one profile run (spec §19) + assessment | Passes (1.9× margin over the limit) |
| Live run, Instagram, 5 delivered | 100 | 0.2029 | 0.0676 | USD 0.017 per run (pilot: 2 runs, 5 + 5 delivered, USD 0.034) | Passes |
| Live run, YouTube | 50 + 10 per creator | 0.1217 (1 creator) | 0.0406 | USD 0.001–0.005 (YouTube API is USD 0; Serper and AI only) | Passes |
| Live run, TikTok in scope | 50 + 10 per creator | see below | see below | USD 0.065 for one run (USD 0.054 Apify), delivering 0 | **Fails for 1–4 creators** |

### The exact shortfall: TikTok live runs

Charge for `k` new creators is `50 + 10k` credits. With the one measured TikTok run cost of USD 0.065:

| New creators delivered | Charge (credits) | Revenue (USD) | Allowed cost for 3× (USD) | Shortfall vs USD 0.065 |
|---|---|---|---|---|
| 1 | 60 | 0.1217 | 0.0406 | USD 0.0244 (needs 96 credits) |
| 2 | 70 | 0.1420 | 0.0473 | USD 0.0177 (needs 96 credits) |
| 3 | 80 | 0.1623 | 0.0541 | USD 0.0109 (needs 96 credits) |
| 4 | 90 | 0.1826 | 0.0609 | USD 0.0041 (needs 96 credits) |
| 5 | 100 | 0.2029 | 0.0676 | none |

The minimum charge that covers USD 0.065 at 3× is `0.065 × 3 ÷ 0.002029 = 96.1` credits. With the 2× extraction pilot
(TikTok up to +USD 0.09 per run, spec §20), the cost could reach about USD 0.155, which needs 229 credits: more than the
largest quote (200). A run that delivers nothing earns nothing by policy, so its whole cost is a loss.

## Recommendations (for owner decision; none applied)

1. **Execution cap per job (preferred; keeps the approved prices):** stop paid extraction once a job's recorded direct cost
   reaches one third of the revenue of what it has delivered so far, with a floor for the first extraction batch. As a
   simple fixed version: cap direct cost at USD 0.040 for a 5-creator quote, USD 0.100 for 10 and USD 0.135 for 15. The
   worker already records cost per call (`provider_calls`) and enforces a monthly Apify budget; a per-job cap is the
   missing piece (LIVE-004).
2. **Keep the TikTok extraction multiplier at 1×.** At 2× no quote size meets the rule.
3. **Alternative pricing (if caps hurt yield):** a TikTok-specific base of 90 credits instead of 50, or charge the 50-credit
   base only after at least 4 TikTok creators are delivered. Both change the owner-approved schedule, so they need approval.
4. **Zero-result runs:** they are free to the customer and cost USD 0.001–0.065 each. Track the share of zero-result runs
   per platform; if it stays high, the per-job cap (1) also bounds this loss.

## Owner decision 2026-10-14 (implemented)

- **TikTok minimum (provisional):** a successful live run with TikTok in scope is charged at least **100 credits**,
  never more than its quote; failed, empty and canceled runs keep the normal rule. 100 credits ≈ USD 0.203 of revenue
  at the Scale-yearly rate, enough for the one measured USD 0.065 run under the 3× rule (96 needed). This does **not**
  guarantee a margin: it rests on one measured run, and payment fees (Paddle's rate unverified) are not deducted.
  Re-measure TikTok runs in an authorised capped pilot before making it final.
- **Per-job cost cap** is enforced before every extraction batch, the first included, with per-profile estimates
  (Instagram USD 0.0026, TikTok USD 0.011, YouTube USD 0); a TikTok-heavy size-10 run is therefore trimmed to the
  profiles the cap allows instead of overspending.
- **Add-by-link:** 50 credits for a new creator import only; a link that is (or turns out to be) a known creator, a
  reuse of fresh data, or a failure costs nothing; an explicit refresh costs 50.
- **Credits:** top-up credits never expire; monthly credits end at renewal (no rollover); top-ups are spent last.

## Limits of this analysis

- One TikTok run and two Instagram pilot runs are a very small sample; costs vary with actor pricing, profile counts and
  retries. Re-measure with an authorised capped pilot (per-job costs are now in the staff job inspector, migration 0028).
- LLM costs use published per-token prices (Groq USD 0.075/0.30 and Ollama Cloud USD 0.07/0.30 per million tokens,
  checked 2026-10-14). Before commit 221f785, Ollama calls were recorded as USD 0; 63 recorded Ollama calls (30,220 input and
  27,242 output tokens) would have cost about USD 0.010.
- Fixed costs (hosting, database, support time) and payment fees are not included.
