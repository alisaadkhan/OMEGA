import { useBillingSummary } from "../../api/billing";
import { providerActionsLockedText } from "../../lib/provider-actions";
import { AnimatePresence, motion } from "motion/react";
import { X, Instagram, Youtube, Music2, MapPin, Mail, Phone, Sparkles, ShieldCheck,  Plus, ExternalLink, RefreshCw, GitCompare } from "lucide-react";
import { useEffect, useState } from "react";
import { FreshnessBadge, ContactTrustBadge, Unavailable, Spinner } from "./states";
import { useActiveJobs, useStartJob } from "../../api/discovery";
import { isOpenJob, jobStatusText } from "../../api/discovery-mapping";
import { useCreatorProfile, useForgetReveal, useRevealContact } from "../../api/search";
import { useAuth } from "../../auth/AuthContext";
import { CONTACT_AVAILABILITY_TEXT, contactEvidenceText, formatCount, uiContactState } from "../../api/search-mapping";
import { countryWithSource } from "../../api/evidence-mapping";
import { useConfirm, useToast } from "../../lib/toast";
import { AudienceEstimate } from "./AudienceEstimate";
import { AttributeEvidence } from "./AttributeEvidence";
import { SaveToListMenu } from "./SaveToListMenu";
import { AddToCampaignMenu } from "./AddToCampaignMenu";
import { blockedReasonFor, eligibilityNote, ineligibleText } from "../../lib/eligibility";
import { relative } from "../../lib/time";

/** Volume 4B — Creator Intelligence Profile. */

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
  /** Fit score for the current search (0 when opened outside a search). */
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

/** Human-readable creator size band (§8.1). */
function sizeLabel(followers: number | null): string {
  if (followers === null) return "Unknown audience size";
  if (followers >= 1_000_000) return "Mega";
  if (followers >= 500_000) return "Macro";
  if (followers >= 100_000) return "Mid-tier";
  if (followers >= 10_000) return "Micro";
  return "Nano";
}

const PLATFORM_URL: Record<Creator["platform"], (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
};

function PlatformIcon({ platform, size = 14 }: { platform: Creator["platform"]; size?: number }) {
  const map = {
    instagram: { Icon: Instagram, bg: "bg-gradient-to-br from-pink-500 to-orange-400" },
    tiktok: { Icon: Music2, bg: "bg-slate-900" },
    youtube: { Icon: Youtube, bg: "bg-red-500" },
  }[platform];
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white ${map.bg}`} style={{ width: size + 8, height: size + 8 }}>
      <map.Icon style={{ width: size - 2, height: size - 2 }} strokeWidth={2} />
    </span>
  );
}

function scoreColor(v: number) {
  if (v >= 90) return "#10b981";
  if (v >= 75) return "#6366f1";
  if (v >= 60) return "#f59e0b";
  return "#ef4444";
}

export function CreatorProfilePanel({ creator, onClose, onCompare }: { creator: Creator | null; onClose: () => void; onCompare?: (c: Creator) => void }) {
  const id = creator?.id ?? null;
  const profile = useCreatorProfile(id);
  const reveal = useRevealContact(id);
  const confirm = useConfirm();
  const toast = useToast();
  const p = profile.data;
  // Creator eligibility (elig-1): saving or adding is blocked for creators below the minimum; the reason is shown.
  const blocked = p ? blockedReasonFor([p.eligibility]) : null;
  const primary = p?.profiles[0];
  const start = useStartJob();
  const refreshLocked = providerActionsLockedText(useBillingSummary().data);
  const jobs = useActiveJobs();
  const refreshing = jobs.data?.jobs.find((j) => j.kind === "refresh" && j.creatorId === id && isOpenJob(j)) ?? null;

  // Escape closes the panel, as for any modal dialog (keyboard users have no other way out but Tab to the close button).
  useEffect(() => {
    if (!creator) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=alertdialog]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creator, onClose]);

  async function onRefresh() {
    if (!p || !id) return;
    const ok = await confirm({
      title: `Refresh @${p.handle}'s data for ${p.refreshCost} credits?`,
      body: "MUSHIN fetches their latest public numbers and assesses them again. If it fails, the credits are returned.",
      confirmLabel: `Refresh for ${p.refreshCost} credits`,
      cancelLabel: "Not now",
    });
    if (!ok) return;
    start.mutate(
      { kind: "refresh", creatorId: id, confirmedCost: p.refreshCost },
      {
        onSuccess: (r) => {
          if (r.status === "up_to_date") toast.info("Already up to date", `Updated ${relative(r.updatedAt)}. No credits used.`);
        },
        onError: (err) => toast.error("Couldn't refresh this creator", err instanceof Error ? err.message : undefined),
      },
    );
  }

  const { user } = useAuth();
  const forget = useForgetReveal(id);
  async function onForget() {
    const ok = await confirm({
      title: "Remove revealed contacts?",
      body: "Their email and phone are hidden again for everyone on your team. Revealing them again costs credits.",
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (!ok) return;
    forget.mutate(undefined, {
      onSuccess: () => toast.success("Revealed contacts removed for your team"),
      onError: (err) => toast.error("Couldn't remove the contacts", err instanceof Error ? err.message : undefined),
    });
  }

  async function onReveal() {
    if (!p) return;
    const ok = await confirm({
      title: `Reveal contact info for ${p.revealCost} credits?`,
      body: "You pay once: everyone on your team can see these contact details afterwards. Contact quality varies — check the trust label.",
      confirmLabel: `Reveal for ${p.revealCost} credits`,
      cancelLabel: "Not now",
    });
    if (!ok) return;
    reveal.mutate(p.revealCost, {
      onSuccess: (r) => toast.success(r.charged ? `Contact details revealed · ${p.revealCost} credits used` : "Already revealed — no credits used"),
      onError: (err) => toast.error("Couldn't reveal contact details", err instanceof Error ? err.message : undefined),
    });
  }

  return (
    <AnimatePresence>
      {creator && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]" />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Creator profile"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="text-xs text-slate-500">Creator profile</div>
              <div className="flex items-center gap-1">
                {id && <SaveToListMenu creatorIds={[id]} blockedReason={blocked} />}
                {id && <AddToCampaignMenu creatorIds={[id]} blockedReason={blocked} />}
                <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>
            {p && !p.eligibility.eligible && (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-[11px] text-amber-800" data-testid="eligibility-banner">
                Not shown in MUSHIN search: {ineligibleText(p.eligibility)}. It can't be added to lists or campaigns; saved entries stay.
              </div>
            )}
            {p && p.eligibility.eligible && (
              <div className="border-b border-slate-100 px-5 py-1.5 text-[11px] text-slate-500" data-testid="eligibility-banner">
                Meets the 10,000-follower minimum on {p.eligibility.qualifyingPlatforms.map((x) => x[0]?.toUpperCase() + x.slice(1)).join(", ")}
                {eligibilityNote(p.eligibility) ? ` · ${eligibilityNote(p.eligibility)}` : ""}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {/* Hero */}
              <div className="relative border-b border-slate-100">
                <div aria-hidden className="absolute inset-0 opacity-40" style={{ backgroundImage: `url(${creator.avatar})`, backgroundSize: "cover", filter: "blur(40px)" }} />
                <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white" />
                <div className="relative flex items-start gap-4 px-6 py-6">
                  <div className="relative">
                    <img src={p?.avatarUrl ?? creator.avatar} alt={creator.name} className="h-20 w-20 rounded-full object-cover ring-4 ring-white shadow-md" />
                    <span className="absolute -bottom-1 -right-1">
                      <PlatformIcon platform={creator.platform} size={14} />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="text-slate-900" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>{p?.displayName ?? creator.name}</div>
                      {(p?.verified ?? creator.verified) && (
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-indigo-500" aria-label="Verified">
                          <path d="M12 2l2.4 2.1 3.2-.4.8 3.1 2.6 1.9-1.5 2.8L21 15l-3 1-.4 3.2-3.2.3L12 22l-2.4-2.1-3.2.3L6 17l-3-1 .5-3.2L1.9 10 3.5 7.2 3 4.7l3.2-.4L9.6 2 12 4z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <a href={primary?.url ?? PLATFORM_URL[creator.platform](creator.handle)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-indigo-600">
                        @{creator.handle}
                        <ExternalLink className="h-3 w-3" strokeWidth={2} />
                      </a>
                      {primary && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>{sizeLabel(primary.followers)} · {formatCount(primary.followers)} followers</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {p?.city && <Chip><MapPin className="h-3 w-3" /> {p.city}</Chip>}
                      {p && countryWithSource(p.country, p.countrySource) && <Chip>{countryWithSource(p.country, p.countrySource)}</Chip>}
                      {p?.nicheClassification?.status === "variety" && <Chip>Variety</Chip>}
                      {p?.niches.map((n) => <Chip key={n}>{n}</Chip>)}
                      {p?.tags.map((t) => (
                        <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{t}</span>
                      ))}
                      {p?.linkedAccounts
                        .filter((l) => l.url.startsWith("https://") || l.url.startsWith("http://"))
                        .map((l) => (
                          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:text-indigo-600">
                            {l.platform === "website" ? "Website" : (l.platform[0]?.toUpperCase() ?? "") + l.platform.slice(1)} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))}
                      {primary && <FreshnessBadge value={primary.freshness.followers} updated={relative(primary.updatedAt.followers)} />}
                    </div>
                  </div>
                </div>
              </div>

              {profile.isLoading && <div className="flex items-center gap-2 px-6 py-6 text-xs text-slate-500"><Spinner /> Loading profile…</div>}
              {profile.isError && <div className="px-6 py-6"><Unavailable /></div>}

              {p && (
                <>
                  {/* AI summary (SRS REQ-03.01) */}
                  <div className="px-6 pt-5">
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-indigo-600" strokeWidth={2} />
                        <span className="text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>AI summary</span>
                        <span className="rounded-full border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-indigo-700" style={{ fontWeight: 600 }}>
                          AI-generated · may be inaccurate
                        </span>
                      </div>
                      {p.summary.text && <p className="mt-1.5 text-sm text-slate-700" style={{ lineHeight: 1.5 }}>{p.summary.text}</p>}
                      {p.summary.status === "generating" && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><Spinner /> {p.summary.text ? "Updating the summary with newer data…" : "Writing a summary…"}</p>
                      )}
                      {p.summary.status === "unavailable" && <p className="mt-1.5 text-xs text-slate-500">Summary unavailable right now. Try again later.</p>}
                      {onCompare && (
                        <div className="mt-3 flex justify-end border-t border-indigo-100 pt-3">
                          <button onClick={() => onCompare(creator)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                            <GitCompare className="h-3 w-3" strokeWidth={2} /> Compare
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {p.attributeEvidence.length > 0 && (
                    <div className="px-6 pt-5">
                      <AttributeEvidence items={p.attributeEvidence} />
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-3">
                    {/* Fit + authenticity with its evidence (SRS REQ-01.02, §5.5) */}
                    <Section title="MUSHIN Intelligence">
                      <div className="mt-3 flex flex-col items-center">
                        {creator.score > 0 && <ScoreRing value={creator.score} />}
                        {creator.fitLabel && <div className="mt-1 text-xs text-slate-600" style={{ fontWeight: 600 }}>{creator.fitLabel}</div>}
                        <div className="mt-4 w-full space-y-2.5 text-xs">
                          {p.authenticity.status === "assessed" ? (
                            <>
                              <SubScore label="Authenticity (estimate)" value={p.authenticity.score} />
                              <ul className="space-y-1.5 text-[11px] text-slate-600">
                                {p.authenticity.evidence.map((e) => (
                                  <li key={e.signal} className="flex gap-1.5">
                                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" strokeWidth={2} />
                                    <span><span style={{ fontWeight: 600 }}>{e.signal}:</span> {e.detail}</span>
                                  </li>
                                ))}
                              </ul>
                              {p.authenticity.fakeFollowerPct !== null && (
                                <p className="text-[11px] text-slate-500">Estimated flagged followers: {p.authenticity.fakeFollowerPct}%</p>
                              )}
                            </>
                          ) : (
                            <p className="text-[11px] text-slate-500">
                              {p.authenticity.status === "pending"
                                ? "Assessment pending. MUSHIN is analysing this creator; check back in a few minutes."
                                : p.authenticity.status === "insufficient_data"
                                  ? "Not enough recent posts to assess. MUSHIN needs at least 3 recent posts with public likes."
                                  : p.authenticity.status === "restricted"
                                    ? "Not available for YouTube data. MUSHIN shows YouTube's own public counts but does not calculate engagement or authenticity from them while its use is under policy review."
                                    : "Not yet assessed. The authenticity score appears once MUSHIN has analysed this creator, always with the evidence behind it."}
                            </p>
                          )}
                        </div>
                      </div>
                    </Section>

                    <div className="space-y-4 lg:col-span-2">
                      <Section title="Performance" subtitle={primary ? `Updated ${relative(primary.updatedAt.followers)}` : undefined}>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <Stat label="Followers" value={primary ? formatCount(primary.followers) : "—"} />
                          <Stat label="Posts" value={primary?.posts != null ? formatCount(primary.posts) : "—"} />
                          <Stat label="Eng. rate" value={primary?.engagementRate != null ? `${primary.engagementRate.toFixed(1)}%` : "—"} />
                          <Stat label="Avg likes" value={primary?.avgLikes != null ? formatCount(primary.avgLikes) : "—"} />
                          <Stat label="Avg comments" value={primary?.avgComments != null ? formatCount(primary.avgComments) : "—"} />
                          <Stat label="Avg views" value={primary?.avgViews != null ? formatCount(primary.avgViews) : "—"} />
                        </div>
                        {p.profiles.length > 1 && (
                          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                            {p.profiles.map((pr) => (
                              <li key={pr.platform} className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5"><PlatformIcon platform={pr.platform} size={10} /> @{pr.handle}</span>
                                <span className="flex items-center gap-2 tabular-nums">{formatCount(pr.followers)} <FreshnessBadge value={pr.freshness.followers} /></span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Section>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 px-6 pb-5 lg:grid-cols-2">
                    {/* Optional and on demand: nothing is estimated or charged until the user asks. */}
                    <Section title="Audience Details" subtitle="Optional · experimental estimate on request">
                      <AudienceEstimate creatorId={p.id} handle={p.handle} />
                    </Section>

                    {/* Contact reveal (SRS REQ-01.03, §5.2) */}
                    <Section title="Contact & trust" subtitle={!p.revealed && p.hasContacts && !p.minorProtected ? `Reveal uses ${p.revealCost} credits` : undefined}>
                      <div className="mt-3 space-y-2 text-xs">
                        {p.minorProtected ? (
                          <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                            Contact details are hidden: this creator may be under 18. This protection can only be lifted by MUSHIN staff.
                          </p>
                        ) : !p.hasContacts ? (
                          <>
                            <p className="text-[11px] text-slate-600" style={{ fontWeight: 500 }}>{CONTACT_AVAILABILITY_TEXT[p.contactAvailability].label}</p>
                            {p.contacts.map((ch) => (
                              <p key={ch.id} className="text-[10px] text-slate-500">{ch.masked} — {contactEvidenceText(ch, relative)}</p>
                            ))}
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] text-slate-600" style={{ fontWeight: 500 }}>{CONTACT_AVAILABILITY_TEXT[p.contactAvailability].label}</p>
                            {p.contacts.map((ch) => (
                              <div key={ch.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                <div className="flex items-center gap-2">
                                  {ch.kind === "email" ? <Mail className="h-3.5 w-3.5 text-slate-500" /> : <Phone className="h-3.5 w-3.5 text-slate-500" />}
                                  <span className={`text-slate-900 ${ch.kind === "phone" ? "tabular-nums" : ""}`} style={{ fontWeight: 500 }}>{ch.value ?? ch.masked}</span>
                                  <span className="ml-auto"><ContactTrustBadge state={uiContactState(ch.status)} /></span>
                                </div>
                                <p className="mt-1 text-[10px] text-slate-500">{contactEvidenceText(ch, relative)}</p>
                              </div>
                            ))}
                            {p.revealed && (user?.role === "owner" || user?.role === "admin") && (
                            <button
                              onClick={() => void onForget()}
                              disabled={forget.isPending}
                              className="mt-1 text-[11px] text-slate-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-60"
                            >
                              Remove revealed contacts for your team
                            </button>
                            )}
                            {!p.revealed && (
                              <button
                                onClick={() => void onReveal()}
                                disabled={reveal.isPending}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 px-3 py-3 text-xs text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-60"
                                style={{ fontWeight: 500 }}
                              >
                                {reveal.isPending ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />}
                                Reveal contact details — {p.revealCost} credits
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </Section>
                  </div>
                </>
              )}

              <div className="border-t border-slate-100 px-6 py-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{refreshing ? jobStatusText(refreshing) : `Last updated ${p ? relative(p.lastScrapedAt) : "—"}`}</span>
                  <button
                    onClick={() => void onRefresh()}
                    disabled={!p || refreshing !== null || start.isPending || refreshLocked !== null}
                    title={refreshLocked ?? undefined}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-indigo-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
                    style={{ fontWeight: 500 }}
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} strokeWidth={2} /> {refreshing ? "Refreshing…" : `Update info · ${p?.refreshCost ?? "—"} credits`}
                  </button>
                </div>
                {refreshLocked && <p className="mt-1 text-right text-xs text-slate-600" data-testid="update-locked">Update info: {refreshLocked}</p>}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>
          {title}
        </div>
        {subtitle && <div className="text-[11px] text-slate-500">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-slate-600 backdrop-blur">
      {children}
    </span>
  );
}

function SubScore({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{value}</span>
      </div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: scoreColor(value) }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="tabular-nums text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = scoreColor(value);
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} stroke="rgb(241 245 249)" strokeWidth="10" fill="none" />
      <motion.circle
        cx="70"
        cy="70"
        r={r}
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1, ease: "easeOut" }}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="74" textAnchor="middle" fill="rgb(15 23 42)" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {value}
      </text>
      <text x="70" y="94" textAnchor="middle" fill="rgb(100 116 139)" style={{ fontSize: 9, letterSpacing: "0.14em" }}>
        CREATOR FIT
      </text>
    </svg>
  );
}
