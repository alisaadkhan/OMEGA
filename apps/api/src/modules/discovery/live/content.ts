import type { LiveSearch } from "@mushin/contracts";
import type { WebResult } from "@mushin/integrations";
import { hasCampaignTopicEvidence } from "../topic-evidence";
import { IG_CONTENT } from "./candidates";
import { RESULT_BUSINESS } from "./relevance";

export { isInstagramContent } from "./candidates";
import type { SearchGroup } from "./trail";

/**
 * Posts and reels as discovery evidence (measured 2026-10-13: about 60% of Instagram results are post/reel links and
 * 98% of them name no author in the title or snippet; a mentioned @handle is often a different account than the author).
 * Authors therefore come only from the provider's reading of the exact post, and mentions only become leads that must
 * pass extraction and every gate like any other candidate.
 */
/** Shop and promotion posts: their authors are businesses (measured: most bridal and beauty post results). */
const POST_COMMERCE = /\b(?:order|orders|whatsapp|price|prices|sale|discount|booking|bookings|collection|stock|rent|rental|shipping|outlet|call now|dm to order)\b/i;
// "@" must start a mention, not sit inside an email address ("name@gmail.com" produced a "gmail.com" lead, 2026-10-13).
const HANDLE = "(?<![\\w.])@([A-Za-z0-9._]{2,30})";
/** A handle next to a creator role, in either order, or a feature ("ft. @x"). */
const MENTION_LEADS = [
  new RegExp(`\\b(?:creator|influencer|blogger|vlogger|youtuber|chef|coach|trainer|educator|foodie|stylist|artist|photographer)s?\\b[^@\\n]{0,40}${HANDLE}`, "gi"),
  new RegExp(`${HANDLE}[^@\\n]{0,25}\\b(?:is|a|the)\\b[^@\\n]{0,20}\\b(?:creator|influencer|blogger|vlogger|youtuber|chef|coach|educator)\\b`, "gi"),
  new RegExp(`\\b(?:ft|feat|featuring|with)\\.?\\s+${HANDLE}`, "gi"),
];
/** Domain-looking or obviously corporate handles are not creator leads. */
const NOT_A_LEAD = /\.(?:com|pk|net|org|co)$|(?:official|store|shop|pk_?official|investments?|funds?|bank|travels?|tours?|salon)$/i;


type ContentResult = { url: string; result: WebResult; query: string; round: number; position: number };

function instagramContent(groups: SearchGroup[]): ContentResult[] {
  const seen = new Set<string>();
  const out: ContentResult[] = [];
  for (const g of groups) {
    if (g.platform !== "instagram") continue;
    g.results.forEach((r, index) => {
      const code = IG_CONTENT.exec(r.link)?.[1];
      if (!code || seen.has(code)) return;
      seen.add(code);
      out.push({ url: r.link.slice(0, 500), result: r, query: g.query, round: g.round, position: index + 1 });
    });
  }
  return out;
}

// Measured 2026-10-13: of 13 automatically chosen posts, 1 author qualified (most were media pages writing about someone,
// or brands); of the 4 posts written in the first person in a hand-picked sample of 12, all 4 authors were creators.
const FIRST_PERSON_POST = /\b(?:i|i'm|i've|i am|my|me|main|meri|mera|mujhe|humne)\b/i;
const THIRD_PERSON_POST = /\b(?:meet|spotlight|is an?|has been|known for|introducing|presents?|interview|announces?|congratulations)\b/i;

/**
 * Posts worth a paid author lookup: no shop/business cues, and written in the creator's own voice (first person, not a
 * media page describing someone); topic-evidenced first, then by search position.
 */
export function postsToResolve(search: LiveSearch, groups: SearchGroup[], limit: number): { chosen: ContentResult[]; business: ContentResult[]; thirdPerson: ContentResult[]; overLimit: ContentResult[] } {
  const text = (c: ContentResult) => `${c.result.title} ${c.result.snippet}`;
  const all = instagramContent(groups);
  const business = all.filter((c) => RESULT_BUSINESS.test(text(c)) || POST_COMMERCE.test(text(c)));
  const rest = all.filter((c) => !business.includes(c));
  const ownVoice = (c: ContentResult) => FIRST_PERSON_POST.test(text(c)) && !THIRD_PERSON_POST.test(text(c));
  const thirdPerson = rest.filter((c) => !ownVoice(c));
  const voiced = rest.filter(ownVoice);
  const onTopic = (c: ContentResult) => hasCampaignTopicEvidence(search, text(c));
  const ordered = [...voiced.filter(onTopic), ...voiced.filter((c) => !onTopic(c))];
  return { chosen: ordered.slice(0, Math.max(0, limit)), business, thirdPerson, overLimit: ordered.slice(Math.max(0, limit)) };
}

/** Handles mentioned next to a creator role in Instagram post titles/snippets; leads only, never identity claims. */
export function mentionLeads(groups: SearchGroup[]): { handle: string; from: ContentResult }[] {
  const leads = new Map<string, { handle: string; from: ContentResult }>();
  for (const c of instagramContent(groups)) {
    const text = `${c.result.title}\n${c.result.snippet}`;
    // A shop's promotion tags models and partners, not creators the brief is looking for.
    if (RESULT_BUSINESS.test(text) || POST_COMMERCE.test(text)) continue;
    for (const pattern of MENTION_LEADS) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const handle = (m[1] ?? "").toLowerCase().replace(/\.+$/, "");
        if (/^[a-z0-9._]{2,30}$/.test(handle) && !NOT_A_LEAD.test(handle) && !leads.has(handle)) leads.set(handle, { handle, from: c });
      }
    }
  }
  return [...leads.values()];
}

/** Recovered profiles as an extra search group: the post's own title/snippet is the evidence carried forward. */
export function contentGroup(kind: "post_author" | "mention", items: { handle: string; from: ContentResult }[]): SearchGroup[] {
  if (items.length === 0) return [];
  return [{
    platform: "instagram",
    query: `${kind}: ${items[0]?.from.query ?? ""}`.slice(0, 300),
    round: items[0]?.from.round ?? 1,
    results: items.map((i) => ({ title: i.from.result.title, link: `https://www.instagram.com/${i.handle}/`, snippet: i.from.result.snippet })),
  }];
}
