import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, Bookmark, ChevronDown, Eye, GitCompare, MapPin, Plus, ShieldCheck, Star, TrendingUp, X } from "lucide-react";
import { useBillingSummary } from "../../api/billing";
import { useActiveJobs, useStartJob } from "../../api/discovery";
import { isOpenJob, jobStatusText } from "../../api/discovery-mapping";
import { countryWithSource } from "../../api/evidence-mapping";
import { useCreatorProfile, useForgetReveal, useRevealContact } from "../../api/search";
import { CONTACT_AVAILABILITY_TEXT, avatarFallback, formatCount } from "../../api/search-mapping";
import { useAuth } from "../../auth/AuthContext";
import { blockedReasonFor, eligibilityNote, ineligibleText } from "../../lib/eligibility";
import { providerActionsLockedText } from "../../lib/provider-actions";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { CampaignDrawer } from "./CampaignDrawer";
import { CreatorFullDetails } from "./CreatorFullDetails";
import { ShortlistDrawer, type DrawerCreator } from "./ShortlistDrawer";
import { Spinner } from "./states";

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
  followers: string;
  followersNum: number | null;
  /** null when unknown or not calculated for the source (e.g. YouTube data under policy review). */
  engagement: number | null;
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
  tags: string[];
  followersFreshness: "current" | "aging" | "stale";
  hasContact: boolean;
  /** null when not known yet (a creator opened from a link before its profile loads). */
  contactAvailability: import("@mushin/contracts").ContactAvailability | null;
};

const PLATFORM_URL: Record<Creator["platform"], (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
};

/**
 * The one creator view (owner 2026-11-02: the older side panel is gone). Opened by "View Profile" and the creator
 * search. The summary stays in view; "Full profile" opens everything else (evidence, authenticity, every platform,
 * audience, contacts, Update info). Shortlist and campaign open their side panels from here.
 */
export function CreatorProfilePanel({ creator, onClose, onCompare, onGoToCampaigns }: { creator: Creator | null; onClose: () => void; onCompare?: (c: Creator) => void; onGoToCampaigns?: () => void }) {
  const id = creator?.id ?? null;
  const profile = useCreatorProfile(id);
  const reveal = useRevealContact(id);
  const forget = useForgetReveal(id);
  const start = useStartJob();
  const jobs = useActiveJobs();
  const confirm = useConfirm();
  const toast = useToast();
  const { user } = useAuth();
  const refreshLocked = providerActionsLockedText(useBillingSummary().data);
  const [full, setFull] = useState(false);
  const [shortlistFor, setShortlistFor] = useState<DrawerCreator[] | null>(null);
  const [campaignFor, setCampaignFor] = useState<DrawerCreator[] | null>(null);
  const p = profile.data;
  const primary = p?.profiles.find((x) => x.platform === creator?.platform) ?? p?.profiles[0];
  const blocked = p ? blockedReasonFor([p.eligibility]) : null;
  const refreshing = jobs.data?.jobs.find((j) => j.kind === "refresh" && j.creatorId === id && isOpenJob(j)) ?? null;
  const drawerOpen = shortlistFor !== null || campaignFor !== null;

  useEffect(() => setFull(false), [id]);
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
      body: "You pay once: everyone on your team can see these contact details afterwards. Contact quality varies, so check the label next to each one.",
      confirmLabel: `Reveal for ${p.revealCost} credits`,
      cancelLabel: "Not now",
    });
    if (!ok) return;
    reveal.mutate(p.revealCost, {
      onSuccess: (r) => toast.success(r.charged ? `Contact details revealed · ${p.revealCost} credits used` : "Already revealed. No credits used."),
      onError: (err) => toast.error("Couldn't reveal contact details", err instanceof Error ? err.message : undefined),
    });
  }

  async function onForget() {
    const ok = await confirm({ title: "Remove revealed contacts?", body: "Their email and phone are hidden again for everyone on your team. Revealing them again costs credits.", confirmLabel: "Remove", cancelLabel: "Keep", destructive: true });
    if (!ok) return;
    forget.mutate(undefined, {
      onSuccess: () => toast.success("Revealed contacts removed for your team"),
      onError: (err) => toast.error("Couldn't remove the contacts", err instanceof Error ? err.message : undefined),
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
  const authenticity = !p
    ? { value: "—", note: "" }
    : p.authenticity.status === "assessed"
      ? { value: `${p.authenticity.score}`, note: "Estimate from public signals" }
      : { value: "—", note: p.authenticity.status === "restricted" ? "Not assessed for YouTube" : p.authenticity.status === "pending" ? "Assessment in progress" : p.authenticity.status === "insufficient_data" ? "Not enough posts to assess" : "Not assessed yet" };

  return (
    <>
      <AnimatePresence>
        {creator && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} onClick={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0F24]/40 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="Creator profile"
              className="relative flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl shadow-indigo-950/20"
            >
              <div className="h-1 w-full shrink-0 bg-gradient-to-r from-cyan-300 via-[#06B6D4] to-[#0A0F24]" />
              <button onClick={onClose} aria-label="Close" className="absolute right-3 top-4 z-10 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                <X className="h-4 w-4" />
              </button>
              <div className="space-y-3 overflow-y-auto p-5">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-14 w-14 shrink-0 rounded-full bg-gradient-to-br from-[#06B6D4] to-[#0A0F24] p-0.5">
                      <img src={p?.avatarUrl ?? creator.avatar} alt="" onError={avatarFallback(p?.displayName ?? creator.name)} className="h-full w-full rounded-full bg-white object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h2 className="truncate text-base font-bold tracking-tight text-slate-900">{p?.displayName ?? creator.name}</h2>
                        {(p?.verified ?? creator.verified) && <BadgeCheck aria-label="Verified" className="h-4 w-4 shrink-0 text-[#06B6D4]" />}
                        <a href={primary?.url ?? PLATFORM_URL[creator.platform](creator.handle)} target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-500 hover:text-cyan-700">@{creator.handle}</a>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                        <span className="truncate">{[niche, p?.city].filter(Boolean).join(" · ") || "Niche and city not known yet"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {creator.score > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-sm font-bold text-cyan-800" title="MUSHIN IQ: how well this creator matches your search. A match score, not an authenticity rating.">
                        <Star aria-hidden className="h-3.5 w-3.5 fill-[#06B6D4] text-[#06B6D4]" /> IQ {creator.score}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500">{refreshing ? jobStatusText(refreshing) : `Updated ${p ? relative(p.lastScrapedAt) : "…"}`}</span>
                  </div>
                </div>

                {p && (
                  <p className={`rounded-xl px-3 py-2 text-[11px] ${p.eligibility.eligible ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-800"}`} data-testid="eligibility-banner">
                    {p.eligibility.eligible
                      ? `Meets the minimum on ${p.eligibility.qualifyingPlatforms.map((x) => x[0]?.toUpperCase() + x.slice(1)).join(", ")}${eligibilityNote(p.eligibility) ? ` · ${eligibilityNote(p.eligibility)}` : ""}`
                      : `Not shown in MUSHIN search: ${ineligibleText(p.eligibility)}. It can't be added to shortlists or campaigns; saved entries stay.`}
                  </p>
                )}

                {profile.isPending ? (
                  <div className="flex justify-center py-8"><Spinner /></div>
                ) : profile.isError ? (
                  <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                    Couldn't load this creator. <button className="font-semibold underline" onClick={() => void profile.refetch()}>Try again</button>
                  </div>
                ) : p ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label={creator.platform === "youtube" ? "Subscribers" : "Followers"} value={formatCount(primary?.followers ?? creator.followersNum)} note={primary?.freshness.followers === "stale" ? "Count may be out of date" : `On ${{ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" }[creator.platform]}`} />
                      <Stat label="Engagement rate" accent value={engagement === null ? "—" : `${engagement.toFixed(1)}%`} note={engagement === null ? (creator.platform === "youtube" ? "Not available for YouTube" : "Not enough recent posts") : "Typical recent post"} icon={engagement !== null ? TrendingUp : undefined} />
                      <Stat label="Audience authenticity" value={authenticity.value} note={authenticity.note} icon={p.authenticity.status === "assessed" ? ShieldCheck : undefined} />
                      <Stat label={primary?.avgViews != null ? "Typical views" : "Posts"} value={primary?.avgViews != null ? formatCount(primary.avgViews) : formatCount(primary?.posts ?? null)} note={primary?.avgViews != null ? "Average of recent posts" : "Published on this account"} />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                      <span>{location ? `Location: ${location}` : "Location not confirmed yet: no public evidence found."}</span>
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Evidence</span>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/80 p-2.5">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Direct contact</div>
                        <div className="truncate text-xs text-slate-900">
                          {p.minorProtected ? "Hidden: this creator may be under 18" : p.contacts.length > 0 ? p.contacts.map((c) => c.value ?? c.masked).join(" · ") : CONTACT_AVAILABILITY_TEXT[p.contactAvailability].label}
                        </div>
                        {p.contacts.length > 0 && !p.minorProtected && <div className="text-[10px] text-slate-500">{CONTACT_AVAILABILITY_TEXT[p.contactAvailability].label}</div>}
                      </div>
                      {!p.revealed && p.hasContacts && !p.minorProtected ? (
                        <button onClick={() => void onReveal()} disabled={reveal.isPending} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#0A0F24] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50">
                          <Eye aria-hidden className="h-3.5 w-3.5 text-cyan-300" /> {reveal.isPending ? "Revealing…" : `Reveal contact details · ${p.revealCost} cr`}
                        </button>
                      ) : p.revealed ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-700"><BadgeCheck className="h-3.5 w-3.5" /> Revealed</span>
                      ) : null}
                    </div>
                  </>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button onClick={() => setShortlistFor([asDrawer(creator)])} disabled={blocked !== null} title={blocked ?? undefined} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:translate-y-0 disabled:opacity-50">
                    <Bookmark aria-hidden className="h-3.5 w-3.5" /> Save to Shortlist
                  </button>
                  <button onClick={() => setCampaignFor([asDrawer(creator)])} disabled={blocked !== null} title={blocked ?? undefined} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0A0F24] px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-950/20 transition-all hover:-translate-y-px hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 active:scale-[0.99] disabled:translate-y-0 disabled:opacity-50">
                    <Plus aria-hidden className="h-3.5 w-3.5 text-cyan-300" /> Add to Campaign
                  </button>
                  {onCompare && (
                    <button onClick={() => onCompare(creator)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                      <GitCompare aria-hidden className="h-3.5 w-3.5" /> Compare
                    </button>
                  )}
                </div>

                {p && (
                  <button onClick={() => setFull((v) => !v)} aria-expanded={full} className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                    {full ? "Hide full profile" : "Full profile: evidence, authenticity, audience, contacts"}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${full ? "rotate-180" : ""}`} />
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {p && full && (
                    <CreatorFullDetails
                      p={p}
                      canForget={user?.role === "owner" || user?.role === "admin"}
                      onForget={() => void onForget()}
                      forgetting={forget.isPending}
                      onRefresh={() => void onRefresh()}
                      refreshText={refreshing ? jobStatusText(refreshing) : `Last updated ${relative(p.lastScrapedAt)}`}
                      refreshDisabled={refreshing !== null || start.isPending || refreshLocked !== null}
                      refreshLocked={refreshLocked}
                      refreshing={refreshing !== null}
                    />
                  )}
                </AnimatePresence>
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

function Stat({ label, value, note, accent = false, icon: Icon }: { label: string; value: string; note: string; accent?: boolean; icon?: typeof TrendingUp }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`my-0.5 flex items-center gap-1.5 text-lg font-bold tabular-nums ${accent ? "text-cyan-700" : "text-slate-900"}`}>
        {value}
        {Icon && <Icon aria-hidden className="h-3.5 w-3.5 text-[#06B6D4]" />}
      </div>
      <div className="text-xs text-slate-500">{note}</div>
    </div>
  );
}
