/** One creator in the search index: global data only, never contact values (SRS §3.3, §5.2). */
export type CreatorDocument = {
  id: string;
  display_name: string;
  name_variants: string[];
  primary_handle: string;
  handles: string[];
  /** Vocabulary words found inside joined-up handles ("karachifoodadventure" → karachi, food), searched like handles. */
  handle_words?: string[];
  platforms: string[];
  primary_platform: string;
  city: string | null;
  country: string | null;
  niches: string[];
  tags: string[];
  bio: string;
  followers: number | null;
  engagement_rate: number | null;
  verified: boolean;
  authenticity_score: number | null;
  has_contact: boolean;
  audience_countries: string[];
  followers_updated_epoch: number | null;
  updated_epoch: number;
  /** Creator eligibility (policy version below): customer-facing searches only return eligible documents whose evidence holds. */
  eligible: boolean;
  /** Epoch seconds until which the eligibility evidence holds; null when not eligible. */
  eligible_until: number | null;
  eligibility_version: string;
  eligibility_reasons: string[];
  eligibility_flags: string[];
  qualifying_platforms: string[];
};

export type SearchHit = { id: string; rankingScore: number };

export interface SearchIndex {
  /** Creates the index if needed and applies searchable/filterable attributes (idempotent). */
  ensureSettings(): Promise<void>;
  upsert(docs: CreatorDocument[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** `sort` orders a filter-only search (no text), so a capped candidate pool holds the strongest matches. */
  search(q: { text: string; filter: string[]; limit: number; sort?: string[] }): Promise<{ hits: SearchHit[]; total: number }>;
  /**
   * Every document id with its `updated_epoch` (nightly reconcile). With `eligibilityVersion`, a document built under
   * another eligibility policy reports -1, so the reconcile rebuilds it.
   */
  listIds(eligibilityVersion?: string): Promise<Map<string, number>>;
  ping(): Promise<"ok">;
  /** Deletes the whole index (tests only). */
  drop(): Promise<void>;
}
