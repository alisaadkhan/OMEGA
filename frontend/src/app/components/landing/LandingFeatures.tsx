import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BadgeCheck, Check, ClipboardList, Database, FileText, LineChart, MapPinned, Megaphone, Radar, Search, Send, SlidersHorizontal, Sparkles, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { EASE, Reveal } from "../../ui/kit";
import { cn } from "../ui/utils";
import { scrollToId } from "./LandingTop";

function Eyebrow({ children }: { children: string }) {
  return <span className="rounded-full border border-cyan-200/60 bg-cyan-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-widest text-teal">{children}</span>;
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">{title}</h2>
      <p className="mt-4 font-display text-base leading-relaxed text-slate-600 sm:text-lg">{body}</p>
    </Reveal>
  );
}

export function LandingFeatures() {
  return (
    <div id="discovery" className="w-full scroll-mt-20 border-t border-slate-200 bg-[#F8FAFC] px-6 py-24 text-slate-900 sm:px-8 sm:py-32">
      <div className="mx-auto flex max-w-6xl flex-col items-center">
        <SectionHead eyebrow="Dual-Engine Discovery" title="Two Ways to Find Your Next Creator" body="Search the Pakistani creators already in MUSHIN instantly, or run a live search against your own brief to find new ones." />
        <div className="mt-14 grid w-full grid-cols-1 gap-8 md:grid-cols-2">
          <Reveal delay={0.05}>
            <EngineCard icon={Database} title="1. Instant Catalogue Search" body="Filter Pakistan-based creators by city, platform, niche and engagement rate in seconds.">
              <div className="mb-3 flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Filter Presets Applied</span>
                <span className="flex items-center gap-1 font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Results in about a second</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Karachi, Lahore", "ER > 4.5%", "100k - 500k Followers"].map((t, i) => (
                  <motion.span key={t} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.08 }} className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm">{t}</motion.span>
                ))}
                <span className="rounded-xl border border-cyan-200 bg-cyan-100/70 px-3 py-1.5 text-xs font-semibold text-teal">Instagram · TikTok · YouTube</span>
              </div>
            </EngineCard>
          </Reveal>
          <Reveal delay={0.12}>
            <EngineCard icon={Sparkles} title="2. Live Discovery" body="Can't find the perfect match? Describe the creators you need and MUSHIN searches the platforms for new profiles, quoted before you confirm.">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" /></span>
                  <span className="truncate italic text-slate-600">"Gen Z skincare creators in Islamabad doing minimal routine reels..."</span>
                </div>
                <span className="shrink-0 rounded-md bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-teal">Live Search</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><Radar className="h-4 w-4 animate-spin text-cyan-600" style={{ animationDuration: "3s" }} /> Searching platforms</span>
                <span className="font-semibold text-emerald-700">New creators added to your results</span>
              </div>
            </EngineCard>
          </Reveal>
        </div>

        <EvidenceSection />
        <WorkflowTabs />
      </div>
    </div>
  );
}

function EngineCard({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-8 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(6,182,212,0.12)] sm:p-10">
      <div>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-teal shadow-sm"><Icon className="h-6 w-6" /></div>
        <h3 className="font-display text-xl font-bold text-slate-900 sm:text-2xl">{title}</h3>
        <p className="mt-3 font-display text-sm leading-relaxed text-slate-600 sm:text-base">{body}</p>
      </div>
      <div className="mt-8 rounded-2xl border border-slate-200/60 bg-slate-50/70 p-5">{children}</div>
    </div>
  );
}

function EvidenceSection() {
  const C = 2 * Math.PI * 50;
  return (
    <div className="mt-28 w-full border-t border-slate-200 pt-20">
      <SectionHead eyebrow="Evidence First" title="Know exactly who you're paying." body="Every creator gets a MUSHIN IQ for your search, with the evidence behind their location, niche and engagement." />
      <div className="mt-14 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/90 bg-white p-8 text-center shadow-[0_10px_30px_-5px_rgba(0,0,0,0.04)] sm:p-10">
            <span className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">MUSHIN IQ</span>
            <div className="relative flex h-52 w-52 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden>
                <circle cx="60" cy="60" r="50" fill="transparent" stroke="#E2E8F0" strokeWidth="10" />
                <motion.circle cx="60" cy="60" r="50" fill="transparent" stroke="#00687A" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} initial={{ strokeDashoffset: C }} whileInView={{ strokeDashoffset: C * 0.06 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: EASE }} />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="font-display text-5xl font-extrabold tracking-tight text-slate-900">94</span>
                <span className="mt-0.5 text-xs font-medium text-slate-500">out of 100</span>
              </div>
            </div>
            <p className="mt-3 max-w-xs text-xs text-slate-500">Our score for how well a creator matches your search. It weighs how closely their niche and content match what you typed, how close they are to your filters (city, platform, followers, engagement), their engagement rate, how real their audience looks, and how fresh their figures are.</p>
          </div>
        </Reveal>
        <div className="flex flex-col gap-4 lg:col-span-7">
          {[
            { i: MapPinned, t: "Location you can check", b: "Country and city come from evidence on the profile, shown with its source. MUSHIN never guesses where someone lives from their name or looks." },
            { i: LineChart, t: "Engagement you can trust", b: "Engagement rate is the median over recent posts, and unusual follower or engagement patterns are flagged as signals to review." },
            { i: ClipboardList, t: "Freshness on every figure", b: "Each number shows when it was last observed, so you always know how current the data is, and you can refresh a creator on demand." },
          ].map((x, k) => (
            <Reveal key={x.t} delay={0.08 * k}>
              <div className="flex items-start gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-teal"><x.i className="h-5 w-5" /></div>
                <div>
                  <h4 className="font-display text-base font-bold text-slate-900">{x.t}</h4>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{x.b}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

type TabId = "search" | "signals" | "campaigns" | "outreach";
const TABS: { id: TabId; label: string; icon: LucideIcon; tag: string; title: string; body: string }[] = [
  { id: "search", label: "Search", icon: Search, tag: "Discovery Suite", title: "Find Pakistan-based creators across Instagram, TikTok & YouTube with precise filters.", body: "Search in English or Roman Urdu, and filter by platform, city, niche, follower band and engagement to find Karachi, Lahore and Islamabad creators fast." },
  { id: "signals", label: "Signals", icon: TrendingUp, tag: "Evidence", title: "Know exactly who you're paying, before you sign.", body: "Review suspicious activity signals: unusual follower patterns and engagement anomalies worth investigating before you commit budget." },
  { id: "campaigns", label: "Campaigns", icon: Megaphone, tag: "Campaign Execution", title: "Keep creators, conversations and campaigns tidy in one platform.", body: "Lists, campaign stages, agreed fees and a shared activity feed keep the whole team on the same page." },
  { id: "outreach", label: "Outreach", icon: Send, tag: "Outreach", title: "Keep every creator conversation next to the campaign.", body: "Use outreach templates, log every contact and its outcome, and keep the history next to the creators you discover and qualify." },
];

function WorkflowTabs() {
  const [tab, setTab] = useState<TabId>("search");
  const t = TABS.find((x) => x.id === tab)!;
  return (
    <div id="capabilities" className="mt-28 w-full border-t border-slate-200 pt-20">
      <SectionHead eyebrow="Core Workflow" title="A single, grounded platform." body="Every step of campaign delivery handled in one system." />
      <div role="tablist" className="no-scrollbar mx-auto mt-10 flex w-full max-w-xl items-center gap-1.5 overflow-x-auto rounded-full border border-slate-300/60 bg-slate-200 p-1.5 shadow-inner sm:gap-2">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={cn("relative flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-2.5 sm:flex-1 text-xs font-semibold transition-colors sm:px-4 sm:text-sm", tab === x.id ? "text-white" : "text-slate-600 hover:text-slate-900")}>
            {tab === x.id && <motion.span layoutId="wf-tab" className="absolute inset-0 rounded-full bg-navy shadow-md" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            <x.icon className="relative h-[17px] w-[17px]" />
            <span className="relative">{x.label}</span>
          </button>
        ))}
      </div>
      <div className="mx-auto mt-12 w-full max-w-6xl">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35, ease: EASE }} className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
            <div className="flex flex-col items-start lg:col-span-5 lg:pr-4">
              <span className="mb-3 rounded-full border border-cyan-200/80 bg-cyan-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal">{t.tag}</span>
              <h3 className="font-display text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">{t.title}</h3>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">{t.body}</p>
              <button onClick={() => scrollToId("pricing")} className="group mt-6 inline-flex items-center gap-2 text-sm font-bold text-teal hover:text-teal-deep">
                Explore {t.label} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
            <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_10px_30px_-5px_rgba(0,0,0,0.04)] sm:p-6 lg:col-span-7">
              {tab === "search" && <SearchMock />}
              {tab === "signals" && <SignalsMock />}
              {tab === "campaigns" && <KanbanMock />}
              {tab === "outreach" && <OutreachMock />}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

const rowIn = (i: number) => ({ initial: { opacity: 0, x: 12 }, animate: { opacity: 1, x: 0 }, transition: { delay: 0.1 + i * 0.07, ease: EASE } });

function SearchMock() {
  const rows = [["AM", "Ayesha M.", "Lahore • 410K followers", 94], ["FQ", "Fahad Q.", "Karachi • 280K followers", 92], ["ZT", "Zainab T.", "Islamabad • 195K followers", 91], ["BH", "Bilal H.", "Lahore • 518K followers", 90]] as const;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
      <div className="flex flex-col justify-between rounded-2xl border border-slate-200/70 bg-slate-50/90 p-3.5 sm:col-span-4">
        <div>
          <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2.5 text-slate-500"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Filters</span><SlidersHorizontal className="h-3.5 w-3.5" /></div>
          {[["Platform", "Instagram"], ["Niche", "Bridal & Couture"], ["Followers", "100K - 1M"], ["Engagement", "ER > 5.0%"]].map(([k, v], i) => (
            <motion.div key={k} {...rowIn(i)} className="mb-2">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">{k}</span>
              <div className="flex items-center justify-between rounded-lg border border-cyan-200/70 bg-cyan-50 px-2.5 py-1.5 text-xs font-semibold text-teal">{v}<Check className="h-3 w-3" /></div>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 border-t border-slate-200/80 pt-2.5 text-center text-[11px] font-medium text-slate-500">84 creators match</div>
      </div>
      <div className="flex flex-col gap-2.5 sm:col-span-8">
        {rows.map(([ini, n, sub, fit], i) => (
          <motion.div key={n} {...rowIn(i)} className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-2.5 transition-colors hover:bg-slate-50">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-200 bg-cyan-100 text-xs font-bold text-teal">{ini}</div>
              <div>
                <div className="flex items-center gap-1 text-xs font-bold text-slate-900">{n}<BadgeCheck className="h-3 w-3 text-cyan-600" /></div>
                <span className="text-[11px] text-slate-500">{sub}</span>
              </div>
            </div>
            <span className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700">IQ {fit}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SignalsMock() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 sm:col-span-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500"><span>Evidence</span><span className="text-emerald-700">3 of 4 found</span></div>
        {[["Country", "Pakistan", "Bio mentions Lahore"], ["City", "Lahore", "Location tag on 6 posts"], ["Niche", "Bridal", "From 12 recent posts"], ["Language", "—", "Not enough evidence"]].map(([k, v, s], i) => (
          <motion.div key={k} {...rowIn(i)} className="rounded-xl border border-slate-200/70 bg-white p-2">
            <span className="block text-[9px] font-bold uppercase text-slate-400">{k}</span>
            <span className="text-xs font-bold text-slate-800">{v}</span>
            <span className="block text-[10px] text-slate-500">{s}</span>
          </motion.div>
        ))}
      </div>
      <div className="flex flex-col justify-between gap-3 sm:col-span-7">
        <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
          <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-800">Engagement over recent posts</span><span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">Last 10 posts</span></div>
          <svg className="h-28 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 300 80" aria-hidden>
            <defs><linearGradient id="lp-sig" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#00687A" stopOpacity="0.25" /><stop offset="100%" stopColor="#00687A" stopOpacity="0" /></linearGradient></defs>
            <path d="M 0 60 Q 40 50, 80 55 T 160 40 T 210 12 T 240 45 T 300 35 L 300 80 L 0 80 Z" fill="url(#lp-sig)" />
            <motion.path d="M 0 60 Q 40 50, 80 55 T 160 40 T 210 12 T 240 45 T 300 35" fill="transparent" stroke="#00687A" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: EASE }} />
            <motion.circle cx="210" cy="12" r="4.5" fill="#f59e0b" stroke="#fff" strokeWidth="2" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.2 }} />
          </svg>
        </div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }} className="flex items-center gap-2.5 rounded-xl border border-amber-200/90 bg-amber-50 p-3 text-xs font-medium text-amber-900">
          One engagement spike flagged for review
        </motion.div>
      </div>
    </div>
  );
}

function KanbanMock() {
  const cols = [["Identified", "bg-slate-200 text-slate-700", [["Mariam K.", "1 Reel", "Rs. 85K"], ["Usman B.", "2 Stories", "Rs. 45K"]]], ["Contacted", "bg-cyan-100 text-cyan-800", [["Zoya K.", "Brief Sent", "Rs. 120K"]]], ["Negotiating", "bg-amber-100 text-amber-800", [["Bilal H.", "Reel + Story", "Rs. 160K"]]], ["Confirmed", "bg-emerald-100 text-emerald-800", [["Ayla M.", "Signed", "Rs. 140K"], ["Sana R.", "Signed", "Rs. 180K"]]]] as const;
  return (
    <>
      <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 text-xs">
        <div className="flex items-center gap-2 font-bold text-slate-900"><Megaphone className="h-4 w-4 text-teal" /> Summer Eid Roster '26</div>
        <span className="text-[11px] font-medium text-slate-500"><Users className="mr-1 inline h-3 w-3" />6 creators</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {cols.map(([name, badge, cards], ci) => (
          <div key={name} className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/90 p-2.5">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-600"><span>{name}</span><span className={cn("rounded-full px-1.5 py-0.5", badge)}>{cards.length}</span></div>
            {(cards as readonly (readonly [string, string, string])[]).map(([n, d, fee], i: number) => (
              <motion.div key={n} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + ci * 0.1 + i * 0.06 }} className="rounded-xl border border-slate-200/80 bg-white p-2">
                <p className="text-[11px] font-bold text-slate-800">{n}</p>
                <div className="mt-1.5 flex items-center justify-between text-[9px]"><span className="rounded bg-slate-100 px-1 py-0.5 font-medium text-slate-500">{d}</span><span className="font-bold text-slate-700">{fee}</span></div>
              </motion.div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function OutreachMock() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/90 p-3 sm:col-span-4">
        <div className="border-b border-slate-200 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">Conversations</div>
        {[["Ayesha M.", "Draft ready", true], ["Bilal H.", "Rate card received", false], ["Sana R.", "Script confirmed", false]].map(([n, s, on], i) => (
          <motion.div key={String(n)} {...rowIn(i)} className={cn("rounded-xl border p-2.5", on ? "border-cyan-300 bg-white" : "border-slate-200/60 bg-white/60")}>
            <span className="text-xs font-bold text-slate-900">{n}</span>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">{s}</p>
          </motion.div>
        ))}
      </div>
      <div className="flex flex-col justify-between rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 sm:col-span-8">
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 border-b border-slate-200/80 pb-2"><span className="font-medium text-slate-400">Subject:</span><span className="font-semibold text-slate-800">Eid Sale 2026 collaboration</span></div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-2 rounded-xl border border-cyan-200/80 bg-cyan-50/80 p-3 text-[11px] leading-relaxed text-slate-700">
            <div className="mb-1.5 flex items-center gap-1.5 font-bold text-teal"><FileText className="h-3.5 w-3.5" /> From your template</div>
            <p className="italic text-slate-600">"Hi Ayesha, loved your recent Lahore bridal series! We're putting together our Eid '26 launch and think your audience is a great fit..."</p>
          </motion.div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-[11px] text-slate-500">Every contact is logged on the campaign</span>
          <span className="flex items-center gap-1.5 rounded-xl bg-navy px-4 py-1.5 text-xs font-bold text-white shadow-sm">Log outreach <Send className="h-3 w-3" /></span>
        </div>
      </div>
    </div>
  );
}
