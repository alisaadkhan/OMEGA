import { motion } from "motion/react";
import { BadgeCheck, ExternalLink, Sparkles } from "lucide-react";
import type { CreatorProfile } from "@mushin/contracts";
import { formatCount, formatEr } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { FreshnessBadge, Spinner } from "./states";

const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/**
 * View details (owner, 17 Nov): the AI summary and every platform's figures. Internal assessment material (profile
 * evidence, authenticity, audience details, contact records) is not shown to customers; the data itself is kept for
 * staff and the assessment. Contacts are unlocked from the actions panel.
 */
export function CreatorFullDetails({ p }: { p: CreatorProfile }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: "easeOut" }} className="space-y-3 overflow-hidden">
      <Section title="AI summary" badge="AI-generated · may be inaccurate" icon={<Sparkles className="h-3.5 w-3.5 text-cyan-700" />}>
        {p.summary.text && <p className="text-sm leading-relaxed text-slate-700">{p.summary.text}</p>}
        {p.summary.status === "generating" && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner /> {p.summary.text ? "Updating the summary with newer data…" : "Writing a summary…"}</p>
        )}
        {p.summary.status === "unavailable" && <p className="text-xs text-slate-500">Summary unavailable right now. Try again later.</p>}
      </Section>

      <Section title="Performance by platform">
        <div className="space-y-2">
          {p.profiles.map((pr) => (
            <div key={pr.platform} className="rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between text-xs">
                <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-cyan-700">
                  {PLATFORM_LABEL[pr.platform]} · @{pr.handle}
                  {pr.verified && <BadgeCheck aria-label={`Verified on ${PLATFORM_LABEL[pr.platform]}`} className="h-3.5 w-3.5 text-[#06B6D4]" />}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <FreshnessBadge value={pr.freshness.followers} updated={relative(pr.updatedAt.followers)} />
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                <Mini label={pr.platform === "youtube" ? "Subscribers" : "Followers"} value={formatCount(pr.followers)} />
                <Mini label="Posts" value={pr.posts != null ? formatCount(pr.posts) : "—"} />
                <Mini label="Eng. rate" value={pr.engagementRate != null ? formatEr(pr.engagementRate) : "—"} />
                <Mini label="Avg likes" value={pr.avgLikes != null ? formatCount(pr.avgLikes) : "—"} />
                <Mini label="Avg comments" value={pr.avgComments != null ? formatCount(pr.avgComments) : "—"} />
                <Mini label="Typical views" value={pr.typicalViews != null ? formatCount(pr.typicalViews) : "—"} />
              </dl>
              {/* A dash always says why (master directive Part 2): restricted, not collected, or too few posts. */}
              {pr.metricsNote && (
                <p className="mt-1.5 text-[10px] text-slate-500">
                  {pr.metricsNote === "policy_restricted" ? "Engagement and views: not calculated for YouTube under its API rules." : pr.metricsNote === "not_collected" ? "Engagement and views: not collected yet. Refresh the profile to fetch recent posts." : "Engagement and views: too few recent posts to judge."}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

    </motion.div>
  );
}

function Section({ title, badge, icon, children }: { title: string; badge?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
        {badge && <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
