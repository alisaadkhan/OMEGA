/**
 * The search filter's niche groups (owner directive 2026-11-15 §4): a short list of core niches instead of the 23
 * catalogue labels. Choosing a group searches every catalogue niche in it; both search backends match any of the
 * given niches against a creator's main and secondary niches (Postgres `&&`, Meilisearch `IN`), so no creator of a
 * covered niche is missed. Every catalogue label belongs to exactly one group (checked by niche-groups.test.ts against
 * the taxonomy, platform.niches / migration 0054).
 */
export const NICHE_GROUPS = [
  { label: "Lifestyle & Vlogs", niches: ["Lifestyle"] },
  { label: "Comedy & Entertainment", niches: ["Comedy", "Entertainment"] },
  { label: "Tech & Gadgets", niches: ["Tech"] },
  { label: "Gaming", niches: ["Gaming"] },
  { label: "Food & Cooking", niches: ["Food"] },
  { label: "Fashion & Beauty", niches: ["Fashion", "Beauty", "Bridal"] },
  { label: "Travel", niches: ["Travel"] },
  { label: "Education & Finance", niches: ["Education & How-to", "Finance", "Business & Ecommerce", "Real Estate"] },
  { label: "Fitness & Health", niches: ["Wellness"] },
  { label: "Sports", niches: ["Sports"] },
  { label: "News & Commentary", niches: ["News & Commentary"] },
  { label: "Music", niches: ["Music"] },
  { label: "Religion, History & Literature", niches: ["Religion", "History", "Literature"] },
  { label: "Cars & Automotive", niches: ["Automotive"] },
  { label: "Agriculture", niches: ["Agriculture"] },
] as const;

type Group = (typeof NICHE_GROUPS)[number];

/** The group a value names: a group label, or a catalogue niche (from the AI reading or an older saved search). */
export function nicheGroupOf(value: string): Group | null {
  return NICHE_GROUPS.find((g) => g.label === value || (g.niches as readonly string[]).includes(value)) ?? null;
}

/** The label to show for a selected niche value (its group's). */
export const nicheGroupLabel = (value: string): string => nicheGroupOf(value)?.label ?? value;

/** The catalogue niches to search for a selected value: all of its group's, or the value itself when it has none. */
export const expandNiche = (value: string): string[] => [...(nicheGroupOf(value)?.niches ?? [value])];
