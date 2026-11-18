import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bookmark, Check, Crosshair, Eye, Lock, MapPin, Plus, ShieldCheck, Star, TrendingUp } from "lucide-react";
import { useBillingSummary } from "../../api/billing";
import { useActiveJobs, useStartJob } from "../../api/discovery";
import { isOpenJob, jobStatusText } from "../../api/discovery-mapping";
import { countryWithSource } from "../../api/evidence-mapping";
import { useCreatorProfile, useRevealContact } from "../../api/search";
import { avatarFallback, formatCount, formatEr } from "../../api/search-mapping";
import { blockedReasonFor } from "../../lib/eligibility";
import { providerActionsLockedText } from "../../lib/provider-actions";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { CampaignDrawer } from "./CampaignDrawer";
import { ShortlistDrawer, type DrawerCreator } from "./ShortlistDrawer";
import { VerifiedBadge } from "./VerifiedBadge";

export type Creator = {
  /** Set on catalogue search cards: why the creator matched the query (CAT-005). */
  matchedOn?: import("@mushin/contracts").MatchReason[];
  /** Set on cards found by Find New Creators (sub-project 4B). */
  discovery?: { isNew: boolean; reason: string | null };
  id: string;
  handle: string;
  name: string;
  avatar: string;
  platform: "instagram" | "tiktok" | "youtube";
  city: string;
  niche: string;
  /** "Estimated niche · Based on N recent posts" when the niche was read from posts, not the bio (directive 2026-11-03). */
  nicheNote?: string | null;
  followers: string;
  followersNum: number | null;
  /** null when unknown or not calculated for the source (e.g. YouTube data under policy review). */
  engagement: number | null;
  /** Why engagement is missing on the card: the API's own reason, never assumed from the platform. */
  engagementNote: "policy_restricted" | "insufficient_posts" | null;
  /** null until MUSHIN has assessed the creator (never shown without evidence, SRS §5.5). */
  authenticity: number | null;
  fake: number | null;
  /** MUSHIN IQ for the current search (0 when opened outside a search). */
  score: number;
  fitLabel: string;
  verified: boolean;
  posts: number;
  avgLikes: string;
  avgComments: string;
  followersFreshness: "current" | "aging" | "unknown" | "stale";
  hasContact: boolean;
  /** null when not known yet (a creator opened from a link before its profile loads). */
  contactAvailability: import("@mushin/contracts").ContactAvailability | null;
};

const PLATFORM_NAME: Record<Creator["platform"], string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
const COUNTRY: Record<string, string> = { PK: "Pakistan" };
const PLATFORM_URL: Record<Creator["platform"], (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
};

/** The five location outcomes (master directive Part 4), each said plainly. */
const LOCATION_TEXT: Record<"PAKISTAN_CONFIRMED" | "NON_PAKISTANI_CONFIRMED" | "PAKISTANI_DIASPORA" | "UNKNOWN" | "CONFLICTING_EVIDENCE", (shown: string | null) => string> = {
  PAKISTAN_CONFIRMED: (s) => `Location: ${s ?? "Pakistan"}${s?.includes("confirmed") ? "" : " (confirmed)"}`,
  NON_PAKISTANI_CONFIRMED: (s) => `Based outside Pakistan${s ? `: ${s}` : ""}`,
  PAKISTANI_DIASPORA: (s) => `Pakistani creator based abroad${s ? `: ${s}` : ""}`,
  UNKNOWN: () => "Location not confirmed yet: no public evidence found.",
  CONFLICTING_EVIDENCE: () => "Location unclear: public sources disagree.",
};

/** The API's own reason a metric is missing, never a generic "Unavailable" (master directive 2026-11-03, Part 7). */
function missingNote(note: "policy_restricted" | "not_collected" | "insufficient_posts" | null): string {
  if (note === "policy_restricted") return "Policy restricted for YouTube";
  if (note === "not_collected") return "Not collected yet";
  return "Likes hidden or too few recent posts";
}

/** Content consistency from the measured posting rate in the stored assessment (signals.ts posting_regularity). */
function consistency(evidence: { signal: string; detail: string }[]): { value: string; note: string } {
  const row = evidence.find((e) => e.signal === "posting_regularity");
  if (!row) return { value: "—", note: "Not measured yet" };
  const perWeek = /about ([\d.]+) times? a week/i.exec(row.detail);
  if (perWeek) {
    const n = Number(perWeek[1]);
    return { value: n >= 3 ? "High" : n >= 1 ? "Medium" : "Low", note: `~${n % 1 === 0 ? n : n.toFixed(1)} posts per week` };
  }
  const idle = /no new posts for ([\d,]+) days/i.exec(row.detail);
  return idle ? { value: "Inactive", note: `No new posts for ${idle[1]} days` } : { value: "—", note: row.detail };
}

/**
 * View details (owner design, 18 Nov): one quick-view card — who, four measurements, location evidence, the direct
 * contact and the two main actions. Every value is the creator's own data; a value MUSHIN does not have shows "—".
 * Closes on Escape or a click outside.
 */
export function CreatorProfilePanel({ creator, onClose, onGoToCampaigns }: { creator: Creator | null; onClose: () => void; onCompare?: (c: Creator) => void; onGoToCampaigns?: () => void; sourceMode?: "db_search" | "live_discovery" }) {
  const id = creator?.id ?? null;
  const profile = useCreatorProfile(id);
  const reveal = useRevealContact(id);
  const start = useStartJob();
  const jobs = useActiveJobs();
  const confirm = useConfirm();
  const toast = useToast();
  const refreshLocked = providerActionsLockedText(useBillingSummary().data);
  const [shortlistFor, setShortlistFor] = useState<DrawerCreator[] | null>(null);
  const [campaignFor, setCampaignFor] = useState<DrawerCreator[] | null>(null);
  const p = profile.data;
  const primary = p?.profiles.find((x) => x.platform === p.platform) ?? p?.profiles[0];
  const shownPlatform = primary?.platform ?? creator?.platform ?? "instagram";
  const blocked = p ? blockedReasonFor([p.eligibility]) : null;
  const refreshing = jobs.data?.jobs.find((j) => j.kind === "refresh" && j.creatorId === id && isOpenJob(j)) ?? null;
  const drawerOpen = shortlistFor !== null || campaignFor !== null;

  useEffect(() => {
    if (!creator) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !drawerOpen && !document.querySelector("[role=alertdialog]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creator, onClose, drawerOpen]);

  async function onReveal() {
    if (!p) return;
    const ok = await confirm({
      title: `Reveal contact info for ${p.revealCost} credits?`,
      body: "You pay once: everyone on your account can see these contact details afterwards. Contact quality varies, so check before you reach out.",
      confirmLabel: `Reveal for ${p.revealCost} credits`,
      cancelLabel: "Not now",
    });
    if (!ok) return;
    reveal.mutate(p.revealCost, {
      onSuccess: (r) => toast.success(r.charged ? `Contact details revealed · ${p.revealCost} credits used` : "Already revealed. No credits used."),
      onError: (err) => toast.error("Couldn't reveal contact details", err instanceof Error ? err.message : undefined),
    });
  }

  async function onRefresh() {
    if (!p || !id) return;
    const ok = await confirm({ title: `Refresh @${p.handle}'s data for ${p.refreshCost} credits?`, body: "MUSHIN fetches their latest public numbers and assesses them again. If it fails, the credits are returned.", confirmLabel: `Refresh for ${p.refreshCost} credits`, cancelLabel: "Not now" });
    if (!ok) return;
    start.mutate(
      { kind: "refresh", creatorId: id, confirmedCost: p.refreshCost },
      {
        onSuccess: (r) => (r.status === "up_to_date" ? toast.info("Already up to date", `Updated ${relative(r.updatedAt)}. No credits used.`) : toast.success("Refresh started", "The profile updates when it finishes.")),
        onError: (err) => toast.error("Couldn't refresh this creator", err instanceof Error ? err.message : undefined),
      },
    );
  }

  const asDrawer = (c: Creator): DrawerCreator => ({ id: c.id, name: p?.displayName ?? c.name, handle: c.handle, avatar: p?.avatarUrl ?? c.avatar, city: p?.city ?? null });
  const engagement = primary?.engagementRate ?? null;
  const location = p ? countryWithSource(p.country, p.countrySource) : null;
  const niche = p ? (p.nicheClassification?.main ?? p.niches[0] ?? null) : creator?.niche && creator.niche !== "Unknown" ? creator.niche : null;
  const place = [p?.city, p?.country ? (COUNTRY[p.country] ?? p.country) : null].filter(Boolean).join(", ");
  const verified = primary ? primary.verified : (p?.verified ?? creator?.verified ?? false);
  const auth = p?.authenticity;
  const authenticity = !auth
    ? { value: "—", note: "" }
    : auth.status === "assessed"
      ? { value: `${auth.score}%`, note: auth.score >= 80 ? "High human confidence" : auth.score >= 60 ? "Mostly genuine audience" : auth.score >= 40 ? "Mixed signals" : "Likely inflated" }
      : { value: "—", note: auth.status === "restricted" ? "Not assessed for YouTube" : auth.status === "pending" ? "Assessment in progress" : auth.status === "insufficient_data" ? "Not enough posts to assess" : "Not assessed yet" };
  const steady = consistency(auth?.status === "assessed" ? auth.evidence : []);
  const email = p?.contacts.find((c) => c.kind === "email");
  const phone = p?.contacts.find((c) => c.kind === "phone");
  const contactLine = [email ? (email.value ?? email.masked) : null, phone ? (phone.value ?? phone.masked) : null].filter(Boolean);
  const refreshTitle = refreshLocked ?? `Fetch this creator's latest public data for ${p?.refreshCost ?? 0} credits`;

  return (
    <>
      <AnimatePresence>
        {creator && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} onClick={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="Creator profile"
              className="relative flex max-h-[92vh] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-indigo-950/20"
            >
              <div className="h-1 w-full shrink-0 bg-gradient-to-r from-[#57dffe] via-[#06B6D4] to-[#0B112B]" />
              <div className="flex flex-col gap-2.5 overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                      <div className="h-11 w-11 rounded-full bg-gradient-to-br from-[#06B6D4] to-[#0B112B] p-0.5 shadow-sm">
                        <img src={p?.avatarUrl ?? creator.avatar} alt="" onError={avatarFallback(p?.displayName ?? creator.name)} className="h-full w-full rounded-full bg-white object-cover" />
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h2 id="modal-creator-name" className="truncate text-base font-bold tracking-tight text-slate-900">{p?.displayName ?? creator.name}</h2>
                        {verified && <VerifiedBadge platform={primary?.platform ?? creator.platform} />}
                        <a href={primary?.url ?? PLATFORM_URL[creator.platform](creator.handle)}target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-500 hover:text-cyan-700">@{primary?.handle ?? creator.handle}</a>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                        <span className="truncate">{[niche, place].filter(Boolean).join(" • ") || "Niche and city not known yet"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {creator.score > 0 && (
                      <div className="flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-[#006172]" title="MUSHIN IQ: how well this creator matches your search.">
                        <Star aria-hidden className="h-3.5 w-3.5 fill-[#06B6D4] text-[#06B6D4]" />
                        <span className="text-sm font-bold tracking-tight">{creator.score} IQ</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <span>{refreshing ? jobStatusText(refreshing) : `Last updated ${p ? relative(p.lastScrapedAt) : "…"}`}</span>
                      {p && !refreshing && (
                        <>
                          <span>•</span>
                          <button onClick={() => void onRefresh()} disabled={start.isPending || refreshLocked !== null} title={refreshTitle} className="text-cyan-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50">↻ Refresh</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {profile.isPending ? (
                  <div className="py-8 text-center text-xs text-slate-500">Loading…</div>
                ) : profile.isError ? (
                  <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                    Couldn't load this creator. <button className="font-semibold underline" onClick={() => void profile.refetch()}>Try again</button>
                  </div>
                ) : p ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Tile label={shownPlatform === "youtube" ? "Subscribers" : "Followers"} value={formatCount(primary?.followers ?? creator.followersNum)} note={primary?.freshness.followers === "aging" || primary?.freshness.followers === "stale" ? "Fetched 30+ days ago" : `On ${PLATFORM_NAME[shownPlatform]}`} />
                      <Tile label="Engagement rate" accent value={engagement === null ? "—" : formatEr(engagement)} note={engagement === null ? missingNote(primary?.metricsNote ?? null) : `Median of ${primary?.engagementSample ?? "recent"} recent posts`} icon={engagement === null ? undefined : TrendingUp} />
                      <Tile label="Audience authenticity" value={authenticity.value} valueIcon={auth?.status === "assessed"} note={authenticity.note} />
                      <Tile label="Content consistency" value={steady.value} note={steady.note} />
                    </div>

                    <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-1.5">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Crosshair aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#06B6D4]" />
                        <span className="text-[11px]">{LOCATION_TEXT[primary?.location ?? "UNKNOWN"](location)}</span>
                      </div>
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Evidence</span>
                    </div>

                    {!p.minorProtected && (
                      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/70 p-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100"><Lock aria-hidden className="h-3.5 w-3.5 text-slate-500" /></div>
                          <div className="flex min-w-0 flex-col">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Direct contact</span>
                            <div className="flex items-center gap-2 truncate font-mono text-xs text-slate-900">
                              {contactLine.length ? contactLine.map((c, i) => <span key={c}>{i > 0 && <span className="mr-2">•</span>}{c}</span>) : <span className="font-sans text-slate-500">No email or mobile listed</span>}
                            </div>
                          </div>
                        </div>
                        {p.hasContacts && (
                          <button onClick={() => void onReveal()} disabled={reveal.isPending || p.revealed} aria-label={p.revealed ? "Contacts unlocked" : `Unlock contact for ${p.revealCost} credits`} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs shadow-sm transition-colors ${p.revealed ? "bg-slate-200 text-slate-900" : "bg-[#0F172A] text-white hover:bg-[#0B112B]"}`}>
                            {p.revealed ? <Check aria-hidden className="h-3.5 w-3.5 text-[#06B6D4]" /> : <Eye aria-hidden className="h-3.5 w-3.5 text-[#57dffe]" />}
                            <span>{p.revealed ? "Unlocked" : reveal.isPending ? "Unlocking…" : "Unlock Contact"}</span>
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-0.5">
                      <button onClick={() => setShortlistFor([asDrawer(creator)])} disabled={blocked !== null} title={blocked ?? undefined} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                        <Bookmark aria-hidden className="h-3.5 w-3.5 text-slate-500" /> <span>Save to Shortlist</span>
                      </button>
                      <button onClick={() => setCampaignFor([asDrawer(creator)])} disabled={blocked !== null} title={blocked ?? undefined} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0B112B] px-4 py-2 text-xs text-white shadow-md shadow-indigo-950/20 transition-all hover:bg-[#0F172A] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
                        <Plus aria-hidden className="h-3.5 w-3.5 text-[#57dffe]" /> <span className="font-semibold">+ Add to Campaign</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ShortlistDrawer open={shortlistFor !== null} creators={shortlistFor ?? []} onClose={() => setShortlistFor(null)} />
      <CampaignDrawer open={campaignFor !== null} creators={campaignFor ?? []} onClose={() => setCampaignFor(null)} onGoToCampaigns={onGoToCampaigns} />
    </>
  );
}

function Tile({ label, value, note, accent = false, valueIcon = false, icon: Icon }: { label: string; value: string; note: string; accent?: boolean; valueIcon?: boolean; icon?: typeof TrendingUp }) {
  return (
    <div className="flex flex-col justify-between rounded-xl bg-slate-50 px-3.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="my-0.5 flex items-baseline gap-1.5">
        <span className={`text-[18px] font-bold tabular-nums ${accent ? "text-cyan-700" : "text-slate-900"}`}>{value}</span>
        {valueIcon && <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#06B6D4]" />}
      </div>
      <div className={`flex items-center gap-1 text-xs ${Icon ? "font-medium text-cyan-700" : "text-slate-500"}`}>
        {Icon && <Icon aria-hidden className="h-3.5 w-3.5" />}
        <span>{note}</span>
      </div>
    </div>
  );
}
