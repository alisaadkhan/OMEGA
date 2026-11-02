import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bookmark, BadgeCheck, Eye, MapPin, Maximize2, Plus, ShieldCheck, Star, TrendingUp, X } from "lucide-react";
import { useCreatorProfile, useRevealContact } from "../../api/search";
import { CONTACT_AVAILABILITY_TEXT, formatCount } from "../../api/search-mapping";
import { countryWithSource } from "../../api/evidence-mapping";
import { blockedReasonFor, ineligibleText } from "../../lib/eligibility";
import { relative } from "../../lib/time";
import { useConfirm, useToast } from "../../lib/toast";
import { Spinner } from "./states";
import type { Creator } from "./CreatorProfilePanel";

/**
 * Quick view opened by "View Profile" on a search card: the creator's stored figures, where the location comes from,
 * contact availability and the two next steps (shortlist, campaign). Every value is the creator's record; anything
 * MUSHIN does not know shows as not known. "Full profile" opens the complete panel (evidence, audience, refresh).
 */
export function CreatorQuickView({
  creator,
  onClose,
  onShortlist,
  onCampaign,
  onFullProfile,
}: {
  creator: Creator | null;
  onClose: () => void;
  onShortlist: (c: Creator) => void;
  onCampaign: (c: Creator) => void;
  onFullProfile: (c: Creator) => void;
}) {
  const id = creator?.id ?? null;
  const profile = useCreatorProfile(id);
  const reveal = useRevealContact(id);
  const confirm = useConfirm();
  const toast = useToast();
  const p = profile.data;
  const primary = p?.profiles.find((x) => x.platform === creator?.platform) ?? p?.profiles[0];
  const blocked = p ? blockedReasonFor([p.eligibility]) : null;

  useEffect(() => {
    if (!creator) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=alertdialog]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creator, onClose]);

  async function onReveal() {
    if (!p) return;
    const ok = await confirm({
      title: `Unlock contact details for ${p.revealCost} credits?`,
      body: "You pay once: everyone on your team can see these details afterwards. Contact quality varies, so check the label next to each one.",
      confirmLabel: `Unlock for ${p.revealCost} credits`,
      cancelLabel: "Not now",
    });
    if (!ok) return;
    reveal.mutate(p.revealCost, {
      onSuccess: (r) => toast.success(r.charged ? `Contact details unlocked · ${p.revealCost} credits used` : "Already unlocked. No credits used."),
      onError: (err) => toast.error("Couldn't unlock the contact details", err instanceof Error ? err.message : undefined),
    });
  }

  const authenticity = !p
    ? null
    : p.authenticity.status === "assessed"
      ? { value: `${p.authenticity.score}`, note: p.authenticity.fakeFollowerPct !== null ? `About ${Math.round(p.authenticity.fakeFollowerPct)}% suspect followers` : "Assessed from public signals" }
      : p.authenticity.status === "restricted"
        ? { value: "—", note: "Not assessed for YouTube" }
        : { value: "—", note: p.authenticity.status === "pending" ? "Assessment in progress" : "Not assessed yet" };
  const engagement = primary?.engagementRate ?? null;
  const location = p ? countryWithSource(p.country, p.countrySource) : null;
  const contact = p ? CONTACT_AVAILABILITY_TEXT[p.contactAvailability] : null;

  return (
    <AnimatePresence>
      {creator && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0F24]/40 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quickview-name"
            className="relative w-full max-w-[560px] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-indigo-950/20"
          >
            <div className="h-1 w-full bg-gradient-to-r from-cyan-300 via-[#06B6D4] to-[#0A0F24]" />
            <button onClick={onClose} aria-label="Close" className="absolute right-3 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
              <X className="h-4 w-4" />
            </button>
            <div className="space-y-3 p-5">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 rounded-full bg-gradient-to-br from-[#06B6D4] to-[#0A0F24] p-0.5">
                    <img src={creator.avatar} alt="" className="h-full w-full rounded-full bg-white object-cover" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 id="quickview-name" className="truncate text-base font-bold tracking-tight text-slate-900">{creator.name}</h2>
                      {creator.verified && <BadgeCheck aria-label="Verified" className="h-4 w-4 shrink-0 text-[#06B6D4]" />}
                      <span className="text-xs font-medium text-slate-500">@{creator.handle}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                      <span className="truncate">{[creator.niche, creator.city].filter((x) => x && x !== "Unknown").join(" · ") || "Niche and city not known yet"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  {creator.score > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-sm font-bold text-cyan-800">
                      <Star aria-hidden className="h-3.5 w-3.5 fill-[#06B6D4] text-[#06B6D4]" /> Fit {creator.score}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">Updated {p ? relative(p.lastScrapedAt) : "…"}</span>
                </div>
              </div>

              {profile.isPending ? (
                <div className="flex justify-center py-8"><Spinner /></div>
              ) : profile.isError ? (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  Couldn't load this creator. <button className="font-semibold underline" onClick={() => void profile.refetch()}>Try again</button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Followers" value={formatCount(primary?.followers ?? creator.followersNum)} note={primary?.freshness.followers === "stale" ? "Count may be out of date" : `${creator.platform === "youtube" ? "Subscribers" : "Followers"} on ${{ instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" }[creator.platform]}`} />
                    <Stat label="Engagement rate" accent value={engagement === null ? "—" : `${engagement.toFixed(1)}%`} note={engagement === null ? (creator.platform === "youtube" ? "Not calculated for YouTube" : "Not enough recent posts") : "Likes and comments per post"} icon={engagement !== null ? TrendingUp : undefined} />
                    <Stat label="Audience authenticity" value={authenticity?.value ?? "—"} note={authenticity?.note ?? ""} icon={p?.authenticity.status === "assessed" ? ShieldCheck : undefined} />
                    <Stat label={primary?.avgViews != null ? "Typical views" : "Posts"} value={primary?.avgViews != null ? formatCount(primary.avgViews) : formatCount(primary?.posts ?? null)} note={primary?.avgViews != null ? "Average across recent posts" : "Published on this account"} />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                    <span>{location ? `Location: ${location}` : "Location not confirmed yet: no public evidence found."}</span>
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Evidence</span>
                  </div>

                  {p && !p.eligibility.eligible && (
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Can't be added to shortlists or campaigns: {ineligibleText(p.eligibility)}.</p>
                  )}

                  <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/80 p-2.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Direct contact</div>
                      <div className="truncate font-mono text-xs text-slate-900">
                        {p && p.contacts.length > 0 ? p.contacts.map((c) => c.value ?? c.masked).join(" · ") : (contact?.label ?? "—")}
                      </div>
                    </div>
                    {p && !p.revealed && p.hasContacts && !p.minorProtected ? (
                      <button onClick={() => void onReveal()} disabled={reveal.isPending} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#0A0F24] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50">
                        <Eye aria-hidden className="h-3.5 w-3.5 text-cyan-300" /> {reveal.isPending ? "Unlocking…" : `Unlock · ${p.revealCost} cr`}
                      </button>
                    ) : p?.revealed ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-700"><BadgeCheck className="h-3.5 w-3.5" /> Unlocked</span>
                    ) : null}
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={() => onShortlist(creator)} disabled={blocked !== null} title={blocked ?? undefined} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-sm transition-all hover:-translate-y-px hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:translate-y-0 disabled:opacity-50">
                  <Bookmark aria-hidden className="h-3.5 w-3.5" /> Save to Shortlist
                </button>
                <button onClick={() => onCampaign(creator)} disabled={blocked !== null} title={blocked ?? undefined} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0A0F24] px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-950/20 transition-all hover:-translate-y-px hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 active:scale-[0.99] disabled:translate-y-0 disabled:opacity-50">
                  <Plus aria-hidden className="h-3.5 w-3.5 text-cyan-300" /> Add to Campaign
                </button>
                <button onClick={() => onFullProfile(creator)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/40">
                  <Maximize2 aria-hidden className="h-3.5 w-3.5" /> Full profile
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
