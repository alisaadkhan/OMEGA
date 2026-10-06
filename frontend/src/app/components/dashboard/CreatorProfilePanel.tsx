import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Instagram,
  Youtube,
  Music2,
  MapPin,
  Mail,
  Phone,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Bookmark,
  Plus,
  ArrowUpRight,
  TrendingUp,
  Users,
  ExternalLink,
  RefreshCw,
  Check,
  ThumbsUp,
  GitCompare,
  Lightbulb,
} from "lucide-react";
import { useState } from "react";
import {
  FreshnessBadge,
  SourceBadge,
  ContactTrustBadge,
  contactTrustNote,
  Unavailable,
  Spinner,
} from "./states";
import { getCreatorIntel } from "./data";

/** Volume 4B — Creator Intelligence Profile. */

export type Creator = {
  handle: string;
  name: string;
  avatar: string;
  platform: "instagram" | "tiktok" | "youtube";
  city: string;
  niche: string;
  followers: string;
  followersNum: number;
  engagement: number;
  authenticity: number;
  fake: number;
  score: number;
  verified: boolean;
  posts: number;
  avgLikes: string;
  avgComments: string;
  tags: string[];
};

/** Human-readable creator size band (§8.1). */
function sizeLabel(followers: number): string {
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

/** Update Info button states — spec §8.2. */
type UpdateState = "current" | "updating" | "updated" | "nochange" | "partial" | "failed";

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

export function CreatorProfilePanel({
  creator,
  onClose,
  onCompare,
}: {
  creator: Creator | null;
  onClose: () => void;
  onCompare?: (c: Creator) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [update, setUpdate] = useState<UpdateState>("current");

  const intel = creator ? getCreatorIntel(creator) : null;

  function runUpdate() {
    if (update === "updating") return;
    setUpdate("updating");
    // Simulated refresh — resolves to one of the honest §8.2 outcomes.
    window.setTimeout(() => {
      const outcomes: UpdateState[] = ["updated", "nochange", "partial", "failed"];
      const seed = creator ? creator.handle.length + creator.score : 0;
      setUpdate(outcomes[seed % outcomes.length]);
    }, 1600);
  }

  return (
    <AnimatePresence
      onExitComplete={() => {
        setRevealed(false);
        setUpdate("current");
      }}
    >
      {creator && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div className="text-xs text-slate-500">Creator profile</div>
              <div className="flex items-center gap-1">
                <button className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-50" style={{ fontWeight: 500 }}>
                  <Bookmark className="h-3 w-3" strokeWidth={2} /> Save
                </button>
                <button className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs text-white transition-colors hover:bg-slate-800" style={{ fontWeight: 500 }}>
                  <Plus className="h-3 w-3" strokeWidth={2} /> Add to campaign
                </button>
                <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Hero */}
              <div className="relative border-b border-slate-100">
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-40"
                  style={{
                    backgroundImage: `url(${creator.avatar})`,
                    backgroundSize: "cover",
                    filter: "blur(40px)",
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white" />
                <div className="relative flex items-start gap-4 px-6 py-6">
                  <div className="relative">
                    <img src={creator.avatar} alt={creator.name} className="h-20 w-20 rounded-full object-cover ring-4 ring-white shadow-md" />
                    <span className="absolute -bottom-1 -right-1">
                      <PlatformIcon platform={creator.platform} size={14} />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="text-slate-900" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        {creator.name}
                      </div>
                      {creator.verified && (
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-indigo-500">
                          <path d="M12 2l2.4 2.1 3.2-.4.8 3.1 2.6 1.9-1.5 2.8L21 15l-3 1-.4 3.2-3.2.3L12 22l-2.4-2.1-3.2.3L6 17l-3-1 .5-3.2L1.9 10 3.5 7.2 3 4.7l3.2-.4L9.6 2 12 4z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <a
                        href={PLATFORM_URL[creator.platform](creator.handle)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 hover:text-indigo-600"
                      >
                        @{creator.handle}
                        <ExternalLink className="h-3 w-3" strokeWidth={2} />
                      </a>
                      <span className="text-slate-300">·</span>
                      <span>{sizeLabel(creator.followersNum)} · {creator.followers} followers</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <Chip><MapPin className="h-3 w-3" /> {creator.city}, Pakistan</Chip>
                      <Chip>{creator.niche}</Chip>
                      {creator.tags.map((t) => (
                        <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{t}</span>
                      ))}
                      {intel && <FreshnessBadge value={intel.followersFreshness.value} updated={intel.lastUpdated} />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommendation (§8.7) */}
              {intel && (
                <div className="px-6 pt-5">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-indigo-600" strokeWidth={2} />
                      <span className="text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>
                        {intel.recommendation.label}
                      </span>
                      <span className="rounded-full border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-indigo-700" style={{ fontWeight: 600 }}>
                        {intel.recommendation.confidence} confidence
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700" style={{ lineHeight: 1.5 }}>
                      {intel.recommendation.fit}
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-[11px] text-emerald-700" style={{ fontWeight: 600 }}>
                          <ThumbsUp className="h-3 w-3" strokeWidth={2} /> Pros
                        </div>
                        <ul className="space-y-1 text-xs text-slate-600">
                          {intel.recommendation.pros.map((p) => (
                            <li key={p} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2.5} />{p}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-[11px] text-amber-700" style={{ fontWeight: 600 }}>
                          <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Watch-outs
                        </div>
                        <ul className="space-y-1 text-xs text-slate-600">
                          {intel.recommendation.watchOuts.map((w) => (
                            <li key={w} className="flex gap-1.5"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />{w}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-indigo-100 pt-3">
                      <p className="max-w-md text-[11px] text-slate-500">
                        <span style={{ fontWeight: 600 }}>Why: </span>{intel.recommendation.reason}
                      </p>
                      {onCompare && (
                        <button
                          onClick={() => onCompare(creator)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          style={{ fontWeight: 500 }}
                        >
                          <GitCompare className="h-3 w-3" strokeWidth={2} /> Compare
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-3">
                {/* IQ Score */}
                <Section title="MUSHIN Intelligence Score">
                  <div className="mt-3 flex flex-col items-center">
                    <ScoreRing value={creator.score} />
                    <div className="mt-4 w-full space-y-2.5 text-xs">
                      <SubScore label="Authenticity" value={creator.authenticity} />
                      <SubScore label="Engagement quality" value={Math.round(creator.engagement * 12)} />
                      <SubScore label="Content consistency" value={82} />
                      <SubScore label="Brand safety" value={94} />
                    </div>
                  </div>
                </Section>

                {/* Metrics */}
                <div className="lg:col-span-2 space-y-4">
                  <Section title="Performance">
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Stat label="Followers" value={creator.followers} />
                      <Stat label="Posts" value={String(creator.posts)} />
                      <Stat label="Eng. rate" value={`${creator.engagement.toFixed(1)}%`} />
                      <Stat label="Avg likes" value={creator.avgLikes} />
                      <Stat label="Avg comments" value={creator.avgComments} />
                      <Stat label="Est. CPE" value="Rs. 42" />
                    </div>
                  </Section>

                  <Section title="Engagement integrity" subtitle="Last 90 days">
                    <div className="mt-2 h-32">
                      <svg viewBox="0 0 600 128" className="h-full w-full" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="cpFill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.22" />
                            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {[30, 70].map((y) => (
                          <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="rgb(241 245 249)" strokeDasharray="2 4" />
                        ))}
                        <motion.path
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 1, ease: "easeInOut" }}
                          d="M0,80 C60,70 100,55 160,58 C220,60 260,45 320,48 C380,50 420,35 480,38 C540,40 580,30 600,26"
                          fill="none"
                          stroke="rgb(16 185 129)"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <motion.path
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.4, duration: 0.5 }}
                          d="M0,80 C60,70 100,55 160,58 C220,60 260,45 320,48 C380,50 420,35 480,38 C540,40 580,30 600,26 L600,128 L0,128 Z"
                          fill="url(#cpFill)"
                        />
                      </svg>
                    </div>
                  </Section>
                </div>
              </div>

              {/* Audience */}
              <div className="grid grid-cols-1 gap-4 px-6 pb-5 lg:grid-cols-2">
                <Section title="Audience Details" subtitle={intel ? `Updated ${intel.audienceFreshness.updated} · AI-estimated` : undefined}>
                  {intel ? (
                    <div className="mt-3 space-y-3 text-xs">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-slate-500">
                          <span className="flex items-center gap-1.5">Age <SourceBadge kind="estimated" confidence={intel.age[0]?.confidence} /></span>
                          <span className="text-slate-400">Top: {intel.age.reduce((a, b) => (b.value > a.value ? b : a)).label}</span>
                        </div>
                        <div className="space-y-1.5">
                          {intel.age.map((r) => (
                            <div key={r.label} className="flex items-center gap-2">
                              <span className="w-10 text-slate-500">{r.label}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${r.value}%` }}
                                  transition={{ duration: 0.7, ease: "easeOut" }}
                                  className="h-full rounded-full bg-indigo-500"
                                />
                              </div>
                              <span className="w-8 text-right tabular-nums text-slate-700">{r.value}%</span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[10px] text-slate-400">
                          Estimated from public signals — not a verified fact.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-slate-500">Gender split <SourceBadge kind={intel.gender.source} /></div>
                          <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <motion.div initial={{ width: 0 }} animate={{ width: `${intel.gender.female}%` }} transition={{ duration: 0.7 }} className="bg-pink-500" />
                            <motion.div initial={{ width: 0 }} animate={{ width: `${intel.gender.male}%` }} transition={{ duration: 0.7, delay: 0.2 }} className="bg-indigo-500" />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                            <span>♀ {intel.gender.female}%</span>
                            <span>♂ {intel.gender.male}%</span>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center gap-1.5 text-slate-500">Top cities <SourceBadge kind="public" /></div>
                          <ul className="space-y-0.5">
                            {intel.cities.map((c) => (
                              <li key={c.label} className="flex justify-between"><span>{c.label}</span><span className="tabular-nums text-slate-700">{c.value}%</span></li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3"><Unavailable /></div>
                  )}
                </Section>

                <Section title="Fake engagement detection">
                  <div className="mt-3 flex items-center gap-4">
                    <div>
                      <div className="tabular-nums text-slate-900" style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.02em" }}>
                        {creator.fake}%
                      </div>
                      <div className="text-xs text-slate-500">Flagged interactions</div>
                    </div>
                    <div className="flex-1 space-y-1.5 text-xs">
                      <Signal ok text="No bot networks detected" />
                      <Signal ok text="No pod-style comment clusters" />
                      <Signal warn={creator.fake > 8} text={creator.fake > 8 ? "Elevated view spikes in Mar 2026" : "Steady engagement history"} />
                      <Signal ok text="Brand-safe content classifier: clean" />
                    </div>
                  </div>
                </Section>

                {/* Contact reveal (§8.5–8.6) */}
                <Section title="Contact & trust" subtitle={!revealed ? "Reveal uses 5 credits" : undefined}>
                  <div className="mt-3">
                    {!revealed ? (
                      <>
                        <button
                          onClick={() => setRevealed(true)}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 px-3 py-3 text-xs text-indigo-700 transition-colors hover:bg-indigo-50"
                          style={{ fontWeight: 500 }}
                        >
                          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                          Reveal contact details — 5 credits
                        </button>
                        <p className="mt-1.5 text-[10px] text-slate-400">
                          You will see the cost before any credit is used. Contact quality varies — check the trust label.
                        </p>
                      </>
                    ) : (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2 text-xs">
                        {intel?.contacts.map((ch) => (
                          <div key={ch.kind} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                            <div className="flex items-center gap-2">
                              {ch.kind === "email" ? <Mail className="h-3.5 w-3.5 text-slate-500" /> : <Phone className="h-3.5 w-3.5 text-slate-500" />}
                              <span className={`text-slate-900 ${ch.kind === "phone" ? "tabular-nums" : ""}`} style={{ fontWeight: 500 }}>
                                {ch.trust === "invalid" ? ch.masked : ch.value}
                              </span>
                              <span className="ml-auto"><ContactTrustBadge state={ch.trust} /></span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                              <span>Source: {ch.source}</span>
                              <span>Seen: {ch.lastSeen}</span>
                              {ch.lastVerified && <span className="text-emerald-600">Verified: {ch.lastVerified}</span>}
                            </div>
                            <p className="mt-1 text-[10px] text-slate-400">{contactTrustNote(ch.trust)}</p>
                          </div>
                        ))}
                        <p className="text-[10px] text-slate-400">
                          A successful delivery is evidence the address works, but it does not by itself prove the creator controls it.
                        </p>
                      </motion.div>
                    )}
                  </div>
                </Section>

                {/* Recent posts */}
                <Section title="Recent posts">
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="relative aspect-square overflow-hidden rounded-md bg-gradient-to-br from-slate-100 to-slate-200"
                      >
                        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between text-[10px] text-white">
                          <span className="inline-flex items-center gap-0.5 rounded bg-black/50 px-1.5 py-0.5">
                            <Users className="h-2.5 w-2.5" /> {creator.avgLikes}
                          </span>
                          <span className="inline-flex items-center gap-0.5 rounded bg-black/50 px-1.5 py-0.5">
                            <TrendingUp className="h-2.5 w-2.5" /> +{Math.round(creator.engagement)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>

              <div className="border-t border-slate-100 px-6 py-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Last updated {intel?.lastUpdated ?? "—"}</span>
                  <button
                    onClick={runUpdate}
                    disabled={update === "updating"}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-indigo-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
                    style={{ fontWeight: 500 }}
                  >
                    {update === "updating" ? (
                      <><Spinner /> Checking…</>
                    ) : (
                      <><RefreshCw className="h-3 w-3" strokeWidth={2} /> Update info</>
                    )}
                  </button>
                </div>
                {update === "updated" && (
                  <p className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                    <Check className="mr-1 inline h-3 w-3" strokeWidth={2.5} /> Profile updated just now with newer data.
                  </p>
                )}
                {update === "nochange" && (
                  <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
                    We checked for newer data and found no important change.
                  </p>
                )}
                {update === "partial" && (
                  <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                    Followers and engagement were refreshed. Audience Details were unavailable this time — existing values kept.
                  </p>
                )}
                {update === "failed" && (
                  <p className="mt-2 rounded-md border border-rose-100 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                    <AlertTriangle className="mr-1 inline h-3 w-3" strokeWidth={2} /> Refresh failed. Your existing data was kept — nothing was overwritten.{" "}
                    <button onClick={runUpdate} className="underline" style={{ fontWeight: 600 }}>Try again</button>
                  </p>
                )}
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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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

function Signal({ ok, warn, text }: { ok?: boolean; warn?: boolean; text: string }) {
  const Icon = warn ? AlertTriangle : ShieldCheck;
  const color = warn ? "text-amber-600" : ok ? "text-emerald-600" : "text-slate-500";
  return (
    <div className="flex items-center gap-1.5 text-slate-700">
      <Icon className={`h-3 w-3 ${color}`} strokeWidth={2} />
      <span className="text-[11px]">{text}</span>
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
