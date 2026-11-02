import type { CreatorProfile } from "@mushin/contracts";

/**
 * "Where these details come from" (FRONTEND_REQUIREMENTS CR-01): the evidence behind a creator's city, country,
 * niches and languages, in the words a customer reads. Supported values are the ones shown on the profile; weak and
 * conflicting observations are listed so it is clear why a value is unknown.
 */
export type EvidenceItem = CreatorProfile["attributeEvidence"][number];

export const ATTRIBUTE_LABEL: Record<EvidenceItem["attribute"], string> = { city: "City", country: "Country", niche: "Niche", language: "Language" };
export const SOURCE_LABEL: Record<EvidenceItem["source"], string> = {
  profile_text: "The creator's own bio",
  display_name: "Only the creator's name (not evidence on its own)",
  account_category: "The account category set on the platform",
  post_text: "The creator's recent posts",
  platform_registration: "Declared on the platform (not proof of residence)",
  ai_assessment: "AI reading (not confirmed by the creator's text)",
};
export const STATUS_LABEL: Record<EvidenceItem["status"], { label: string; tone: "good" | "muted" | "warn" }> = {
  supported: { label: "Supported", tone: "good" },
  weak: { label: "Not enough to show", tone: "muted" },
  conflicting: { label: "Conflicting", tone: "warn" },
};

const ORDER: EvidenceItem["attribute"][] = ["city", "country", "niche", "language"];
const STATUS_ORDER: EvidenceItem["status"][] = ["supported", "conflicting", "weak"];
let regions: Intl.DisplayNames | undefined;
/** An ISO country code as its English name (any country). */
export function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

const COUNTRY_SOURCE: Record<NonNullable<CreatorProfile["countrySource"]>, string> = {
  creator_confirmed: "confirmed by the creator",
  creator_stated: "stated in the creator's bio",
  platform_declared: "declared on the platform",
};

/** The shown country with where it comes from ("Canada · stated in the creator's bio"); null when unknown. */
export function countryWithSource(country: string | null, source: CreatorProfile["countrySource"]): string | null {
  if (!country) return null;
  return source ? `${countryName(country)} · ${COUNTRY_SOURCE[source]}` : countryName(country);
}

/** Groups by attribute (city, country, niche, language), supported first; a country code reads as its name. */
export function groupEvidence(items: readonly EvidenceItem[]): { attribute: EvidenceItem["attribute"]; label: string; rows: (EvidenceItem & { display: string })[] }[] {
  return ORDER.map((attribute) => ({
    attribute,
    label: ATTRIBUTE_LABEL[attribute],
    rows: items
      .filter((i) => i.attribute === attribute)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.value.localeCompare(b.value))
      .map((i) => ({ ...i, display: attribute === "country" ? countryName(i.value) : i.value })),
  })).filter((g) => g.rows.length > 0);
}

/** One line for a field with no supported value: why it is shown as unknown. */
export function unknownReason(group: { rows: readonly EvidenceItem[] }): string | null {
  if (group.rows.some((r) => r.status === "supported")) return null;
  if (group.rows.some((r) => r.status === "conflicting")) return "Unknown: the creator's own text points to more than one answer.";
  return "Unknown: only weak signals, which MUSHIN does not treat as fact.";
}
