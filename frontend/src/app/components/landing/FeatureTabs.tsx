import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Search,
  ShieldCheck,
  Workflow,
  Mail,
  Filter,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Paperclip,
  Send,
  ArrowRight,
  Instagram,
  Youtube,
  Music2,
} from "lucide-react";
import { profiles } from "../../auth/profiles";

type TabId = "discover" | "analyze" | "manage" | "email";

type TabDef = {
  id: TabId;
  label: string;
  icon: any;
  headline: string;
  body: string;
  explore: string;
};

const tabs: TabDef[] = [
  {
    id: "discover",
    label: "Search",
    icon: Search,
    headline: "Find Pakistan-based creators across Instagram, TikTok & YouTube with precise filters.",
    body: "Search in English, Roman Urdu or Urdu, and filter by platform, city, niche, follower band and engagement to find Karachi, Lahore and Islamabad creators fast.",
    explore: "Explore Search",
  },
  {
    id: "analyze",
    label: "Signals",
    icon: ShieldCheck,
    headline: "Know exactly who you’re paying — before you sign.",
    body: "Review Suspicious Activity Signals — unusual follower patterns and engagement anomalies worth investigating before you commit budget.",
    explore: "Explore Signals",
  },
  {
    id: "manage",
    label: "Campaigns",
    icon: Workflow,
    headline: "Keep creators, conversations, and campaigns tidy in one workspace.",
    body: "Lists, campaign stages, agreed fees and a shared activity feed keep the whole team on the same page.",
    explore: "Explore Campaigns",
  },
  {
    id: "email",
    label: "Outreach",
    icon: Mail,
    headline: "Personalized outreach at agency scale, drafted by AI.",
    body: "Use outreach templates, log every contact and its outcome, and keep the history next to the creators you discover and qualify.",
    explore: "Explore Outreach",
  },
];

export function FeatureTabs() {
  const [active, setActive] = useState<TabId>("discover");
  const current = tabs.find((t) => t.id === active)!;

  return (
    <section id="platform" className="relative overflow-hidden border-b border-slate-200/60 bg-white py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            The MUSHIN platform
          </div>
          <h2
            className="mt-5 tracking-tight text-slate-900"
            style={{
              fontSize: "clamp(2rem, 4.5vw, 3.25rem)",
              lineHeight: 1.08,
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            Your whole influencer program,
            <span className="block bg-gradient-to-r from-indigo-600 via-slate-900 to-emerald-600 bg-clip-text text-transparent">
              finally connected in one workflow.
            </span>
          </h2>
          {/* The panels below are product illustrations; their creators, handles and numbers are fictional. */}
          <p className="mt-3 text-xs text-slate-500">Product illustrations. Creators, handles and figures shown are fictional examples.</p>
        </div>

        {/* Horizontal tab bar */}
        <div className="mt-12 flex justify-center">
          <div
            role="tablist"
            aria-orientation="horizontal"
            className="relative flex w-full max-w-2xl items-center justify-center rounded-full border border-slate-200 bg-white p-1 shadow-sm"
          >
            {tabs.map((t) => {
              const isActive = t.id === active;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(t.id)}
                  className={`relative z-10 inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-2 py-2.5 text-xs transition-colors duration-200 sm:px-4 sm:text-sm ${
                    isActive ? "text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  {isActive && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-0 rounded-full bg-slate-900 shadow-[0_4px_14px_-2px_rgba(15,23,42,0.35)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <t.icon className="relative hidden h-4 w-4 sm:block" strokeWidth={1.75} />
                  <span className="relative">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content row */}
        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[420px_1fr] lg:items-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={`copy-${current.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3
                className="tracking-tight text-slate-900"
                style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.2 }}
              >
                {current.headline}
              </h3>
              <p
                className="mt-4 max-w-md text-slate-600"
                style={{ fontSize: "1rem", lineHeight: 1.65 }}
              >
                {current.body}
              </p>
              <a
                href="#/signup"
                className="group mt-6 inline-flex items-center gap-1.5 text-sm text-indigo-600 transition-colors duration-200 hover:text-indigo-700"
                style={{ fontWeight: 500 }}
              >
                {current.explore}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
            </motion.div>
          </AnimatePresence>

          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={`preview-${current.id}`}
                initial={{ opacity: 0, y: 14, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_30px_80px_-30px_rgba(15,23,42,0.3)]"
              >
                <div className="flex h-9 items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
                  <div className="ml-3 h-4 w-56 rounded bg-slate-100" />
                </div>
                {active === "discover" && <DiscoverPreview />}
                {active === "analyze" && <AnalyzePreview />}
                {active === "manage" && <ManagePreview />}
                {active === "email" && <EmailPreview />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- previews ---------- */

function PlatformIcon({ platform }: { platform: "instagram" | "tiktok" | "youtube" }) {
  const map = {
    instagram: { Icon: Instagram, bg: "bg-gradient-to-br from-pink-500 to-orange-400" },
    tiktok: { Icon: Music2, bg: "bg-slate-900" },
    youtube: { Icon: Youtube, bg: "bg-red-500" },
  }[platform];
  return (
    <span className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-white ${map.bg}`}>
      <map.Icon className="h-2 w-2" strokeWidth={2.5} />
    </span>
  );
}

function DiscoverPreview() {
  const creators = [
    { name: profiles.ayesha.name, avatar: profiles.ayesha.avatar, handle: "@ayeshamalik", platform: "instagram" as const, niche: "Fashion · Lahore", followers: "684K", er: "6.1%", iq: 91 },
    { name: profiles.fahad.name, avatar: profiles.fahad.avatar, handle: "@fahad.q", platform: "youtube" as const, niche: "Tech · Islamabad", followers: "1.2M", er: "4.4%", iq: 92 },
    { name: profiles.sana.name, avatar: profiles.sana.avatar, handle: "@sanaa.k", platform: "instagram" as const, niche: "Bridal · Karachi", followers: "412K", er: "5.2%", iq: 89 },
    { name: profiles.usman.name, avatar: profiles.usman.avatar, handle: "@usmantariq", platform: "tiktok" as const, niche: "Comedy · Karachi", followers: "2.4M", er: "8.9%", iq: 84 },
  ];
  const filters = ["Instagram", "Bridal", "100K–1M", "ER 5%+", "Karachi + Lahore"];

  return (
    <div className="grid grid-cols-12">
      <aside className="col-span-12 border-b border-slate-100 p-5 md:col-span-4 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 text-xs text-slate-700">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <span style={{ fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 11 }}>
            Filters
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {filters.map((f, i) => (
            <motion.span
              key={f}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700"
            >
              {f}
            </motion.span>
          ))}
        </div>
        <div className="mt-5 space-y-3 text-xs">
          {[
            // Only filters Search really has (2026-10-21: three filters that do not exist were shown here; landing-claims.test).
            { label: "Language", v: "Urdu · Roman Urdu" },
            { label: "Contact", v: "Available" },
            { label: "Data", v: "Fresh only" },
          ].map((r) => (
            <div key={r.label} className="flex items-center justify-between border-t border-slate-100 pt-3 first:border-0 first:pt-0">
              <span className="text-slate-500">{r.label}</span>
              <span className="text-slate-900" style={{ fontWeight: 500 }}>{r.v}</span>
            </div>
          ))}
        </div>
      </aside>
      <div className="col-span-12 p-5 md:col-span-8">
        <div className="mb-4 flex items-center justify-between text-xs text-slate-500">
          <span>3,214 creators match</span>
          <span>Sorted by Creator Fit</span>
        </div>
        <div className="grid grid-cols-1 gap-2.5">
          {creators.map((c, i) => (
            <motion.div
              key={c.handle}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.07 }}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-200 hover:-translate-y-px hover:border-slate-300 hover:shadow-sm"
            >
              <div className="relative flex-shrink-0">
                <img src={c.avatar} alt={c.name} className="h-9 w-9 rounded-full object-cover" />
                <PlatformIcon platform={c.platform} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-900" style={{ fontWeight: 500 }}>{c.name}</div>
                <div className="truncate text-xs text-slate-500">{c.handle} · {c.niche}</div>
              </div>
              <div className="hidden text-right text-xs text-slate-600 sm:block">
                <div className="tabular-nums">{c.followers}</div>
                <div className="tabular-nums text-slate-500">{c.er} ER</div>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700 tabular-nums" style={{ fontWeight: 600 }}>
                IQ {c.iq}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnalyzePreview() {
  return (
    <div className="grid grid-cols-12 gap-0">
      <div className="col-span-12 border-b border-slate-100 p-6 md:col-span-5 md:border-b-0 md:border-r">
        <div className="text-xs uppercase tracking-wider text-slate-500">Creator Fit</div>
        <div className="relative mt-4 flex items-center justify-center">
          <IQRing value={89} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          {[
            { l: "Audience trust", v: "92" },
            { l: "Engagement", v: "5.6%" },
            { l: "Consistency", v: "88" },
            { l: "MUSHIN IQ", v: "91" },
          ].map((m) => (
            <div key={m.l} className="rounded-md border border-slate-200 bg-white p-2.5">
              <div className="text-slate-500">{m.l}</div>
              <div className="mt-0.5 text-slate-900" style={{ fontWeight: 600 }}>{m.v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-span-12 p-6 md:col-span-7">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-900" style={{ fontWeight: 600 }}>Engagement integrity</div>
            <div className="text-xs text-slate-500">Last 90 days · daily</div>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
            <ShieldCheck className="h-3 w-3" /> Signals reviewed
          </div>
        </div>
        <div className="mt-5 h-40">
          <svg viewBox="0 0 600 160" className="h-full w-full">
            <defs>
              <linearGradient id="afill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[40, 80, 120].map((y) => (
              <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="rgb(241 245 249)" />
            ))}
            <motion.path
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: "easeInOut" }}
              d="M0,120 C40,110 80,95 130,90 C190,84 230,70 290,72 C360,75 400,55 470,58 C520,60 560,48 600,40"
              fill="none"
              stroke="rgb(5 150 105)"
              strokeWidth="2"
            />
            <motion.path
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              d="M0,120 C40,110 80,95 130,90 C190,84 230,70 290,72 C360,75 400,55 470,58 C520,60 560,48 600,40 L600,160 L0,160 Z"
              fill="url(#afill)"
            />
            <motion.circle
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 1.1 }}
              cx="420"
              cy="62"
              r="4"
              fill="rgb(5 150 105)"
            />
          </svg>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          One engagement spike flagged for review · Mar 14.
        </div>
      </div>
    </div>
  );
}

function IQRing({ value }: { value: number }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <svg width="160" height="160" viewBox="0 0 160 160">
      <circle cx="80" cy="80" r={r} stroke="rgb(241 245 249)" strokeWidth="10" fill="none" />
      <motion.circle
        cx="80"
        cy="80"
        r={r}
        stroke="rgb(79 70 229)"
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.1, ease: "easeOut" }}
        transform="rotate(-90 80 80)"
      />
      <text
        x="80"
        y="84"
        textAnchor="middle"
        fill="rgb(15 23 42)"
        style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em" }}
      >
        {value}
      </text>
      <text x="80" y="106" textAnchor="middle" fill="rgb(100 116 139)" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
        FIT SCORE
      </text>
    </svg>
  );
}

function ManagePreview() {
  const stages = [
    { name: "Identified", color: "bg-slate-100 text-slate-700", items: [
      { name: profiles.ayesha.name, avatar: profiles.ayesha.avatar },
      { name: profiles.sana.name, avatar: profiles.sana.avatar },
      { name: profiles.hira.name, avatar: profiles.hira.avatar },
    ]},
    { name: "Contacted", color: "bg-indigo-50 text-indigo-700", items: [
      { name: profiles.fahad.name, avatar: profiles.fahad.avatar },
      { name: profiles.bilal.name, avatar: profiles.bilal.avatar },
    ]},
    { name: "Negotiating", color: "bg-amber-50 text-amber-700", items: [
      { name: profiles.usman.name, avatar: profiles.usman.avatar },
    ]},
    { name: "Confirmed", color: "bg-emerald-50 text-emerald-700", items: [
      { name: profiles.zainab.name, avatar: profiles.zainab.avatar },
      { name: profiles.ahmed.name, avatar: profiles.ahmed.avatar },
    ]},
  ];
  return (
    <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
      {stages.map((s, si) => (
        <div key={s.name} className="rounded-lg bg-slate-50/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.color}`} style={{ fontWeight: 600 }}>
              {s.name}
            </span>
            <span className="text-[10px] text-slate-500">{s.items.length}</span>
          </div>
          <div className="space-y-2">
            {s.items.map((it, i) => (
              <motion.div
                key={it.name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + si * 0.05 + i * 0.05 }}
                className="cursor-default rounded-md border border-slate-200 bg-white p-2.5 transition-all duration-200 hover:-translate-y-px hover:shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <img src={it.avatar} alt={it.name} className="h-6 w-6 flex-shrink-0 rounded-full object-cover" />
                  <div className="truncate text-xs text-slate-900" style={{ fontWeight: 500 }}>
                    {it.name}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <TrendingUp className="h-2.5 w-2.5" /> IQ {84 + ((si * 3 + i) % 10)}
                  </span>
                  <span>2d</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailPreview() {
  const threads = [
    { name: profiles.ayesha.name, avatar: profiles.ayesha.avatar, subject: "Re: Eid Sale 2026 collaboration", time: "2m", unread: true, snippet: "Happy to chat — Tuesday works for a quick call." },
    { name: profiles.fahad.name, avatar: profiles.fahad.avatar, subject: "Welcome to the BrandX creator program", time: "1h", unread: false, snippet: "Thanks for the intro deck — reviewing now." },
    { name: profiles.sana.name, avatar: profiles.sana.avatar, subject: "Brief: bridal capsule launch", time: "3h", unread: false, snippet: "Sharing thumbnails by end of day." },
  ];

  const [typed, setTyped] = useState("");
  const full = "Hi Ayesha — loved your Ramadan series. Would love to talk about partnering on BrandX's Eid Sale 2026 push.";

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(full.slice(0, i));
      if (i >= full.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [full]);

  return (
    <div className="grid grid-cols-12">
      <aside className="col-span-12 border-b border-slate-100 md:col-span-5 md:border-b-0 md:border-r">
        <div className="px-4 py-3 text-xs uppercase tracking-wider text-slate-500">Inbox</div>
        <ul className="divide-y divide-slate-100">
          {threads.map((t, i) => (
            <motion.li
              key={t.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 + i * 0.05 }}
              className={`flex cursor-default items-start gap-2.5 px-4 py-3 transition-colors duration-150 hover:bg-slate-50 ${i === 0 ? "bg-slate-50" : ""}`}
            >
              <img src={t.avatar} alt={t.name} className="mt-0.5 h-7 w-7 flex-shrink-0 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-900" style={{ fontWeight: t.unread ? 600 : 500 }}>{t.name}</span>
                  <span className="text-[10px] text-slate-500">{t.time}</span>
                </div>
                <div className="truncate text-xs text-slate-700">{t.subject}</div>
                <div className="truncate text-xs text-slate-500">{t.snippet}</div>
              </div>
            </motion.li>
          ))}
        </ul>
      </aside>
      <div className="col-span-12 flex flex-col md:col-span-7">
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="text-xs text-slate-500">To: ayesha@brandx.pk</div>
          <div className="mt-0.5 text-sm text-slate-900" style={{ fontWeight: 500 }}>
            Eid Sale 2026 collaboration
          </div>
        </div>
        <div className="flex-1 p-5">
          <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-700" style={{ lineHeight: 1.6 }}>
            <span className="inline-flex items-center gap-1.5 text-indigo-600">
              <Sparkles className="h-3 w-3" />
              AI-personalized draft
            </span>
            <p className="mt-2 text-slate-800" style={{ fontSize: "0.8125rem" }}>
              {typed}
              <motion.span
                className="ml-0.5 inline-block h-3 w-[2px] bg-slate-700 align-middle"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
            </p>
          </div>
        </div>
        <div className="border-t border-slate-100 px-5 py-3">
          {/* Part of the illustration, not controls: nothing here is focusable or clickable. */}
          <div className="flex items-center justify-between" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Paperclip className="h-3.5 w-3.5" /> Attach brief
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white">
              <Send className="h-3 w-3" /> Send
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
