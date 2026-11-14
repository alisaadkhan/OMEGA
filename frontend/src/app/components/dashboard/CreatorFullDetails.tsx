import { motion } from "motion/react";
import { BadgeCheck, ExternalLink, Mail, Phone, ShieldCheck, Sparkles } from "lucide-react";
import type { CreatorProfile } from "@mushin/contracts";
import { CONTACT_AVAILABILITY_TEXT, contactEvidenceText, formatCount, uiContactState, formatEr } from "../../api/search-mapping";
import { relative } from "../../lib/time";
import { AttributeEvidence } from "./AttributeEvidence";
import { AudienceEstimate } from "./AudienceEstimate";
import { ContactTrustBadge, FreshnessBadge, Spinner } from "./states";

const PLATFORM_LABEL = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

/**
 * The full creator profile, shown below the summary in the one creator view: AI summary, where location and niche come
 * from, the authenticity assessment with its evidence, every platform's figures, audience details on request, contacts
 * with their trust labels. Refresh profile is beside the IQ score in the header. Every value is the creator's record; unknowns say so.
 */
export function CreatorFullDetails({
  p,
  canForget,
  onForget,
  forgetting,
}: {
  p: CreatorProfile;
  canForget: boolean;
  onForget: () => void;
  forgetting: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: "easeOut" }} className="space-y-3 overflow-hidden">
      <Section title="AI summary" badge="AI-generated · may be inaccurate" icon={<Sparkles className="h-3.5 w-3.5 text-cyan-700" />}>
        {p.summary.text && <p className="text-sm leading-relaxed text-slate-700">{p.summary.text}</p>}
        {p.summary.status === "generating" && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Spinner /> {p.summary.text ? "Updating the summary with newer data…" : "Writing a summary…"}</p>
        )}
        {p.summary.status === "unavailable" && <p className="text-xs text-slate-500">Summary unavailable right now. Try again later.</p>}
      </Section>

      {p.attributeEvidence.length > 0 && (
        <div className="rounded-2xl bg-slate-50 p-3">
          <AttributeEvidence items={p.attributeEvidence} />
        </div>
      )}

      <Section title="Authenticity" icon={<ShieldCheck className="h-3.5 w-3.5 text-cyan-700" />}>
        {p.authenticity.status === "assessed" ? (
          <>
            <p className="text-xs text-slate-600">Estimate <span className="font-semibold text-slate-900">{p.authenticity.score}/100</span>{p.authenticity.fakeFollowerPct !== null ? ` · about ${p.authenticity.fakeFollowerPct}% flagged followers` : ""}</p>
            <ul className="mt-1.5 space-y-1 text-[11px] text-slate-600">
              {p.authenticity.evidence.map((e) => (
                <li key={e.signal}><span className="font-semibold">{e.signal}:</span> {e.detail}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[11px] text-slate-600">
            {p.authenticity.status === "pending"
              ? "Assessment in progress. Check back in a few minutes."
              : p.authenticity.status === "insufficient_data"
                ? "Could not be assessed: MUSHIN needs at least 3 recent posts with public likes."
                : p.authenticity.status === "restricted"
                  ? "Not assessed for YouTube: YouTube's API rules don't allow MUSHIN to derive it."
                  : "Not assessed yet. It appears once MUSHIN has analysed this creator, always with its evidence."}
          </p>
        )}
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

      <Section title="Audience details" badge="Optional · estimate on request">
        <AudienceEstimate creatorId={p.id} handle={p.handle} />
      </Section>

      <Section title="Contacts">
        {p.minorProtected ? (
          <p className="text-[11px] text-slate-600">Contact details are hidden: this creator may be under 18. Only MUSHIN staff can lift this protection.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-slate-600">{CONTACT_AVAILABILITY_TEXT[p.contactAvailability].label}</p>
            {p.contacts.map((ch) => (
              <div key={ch.id} className="rounded-xl bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  {ch.kind === "email" ? <Mail className="h-3.5 w-3.5 text-slate-500" /> : <Phone className="h-3.5 w-3.5 text-slate-500" />}
                  <span className="font-medium text-slate-900">{ch.value ?? ch.masked}</span>
                  <span className="ml-auto"><ContactTrustBadge state={uiContactState(ch.status)} /></span>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{contactEvidenceText(ch, relative)}</p>
              </div>
            ))}
            {p.revealed && canForget && (
              <button onClick={onForget} disabled={forgetting} className="rounded-full text-[11px] text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:opacity-50">
                Remove revealed contacts for your team
              </button>
            )}
          </div>
        )}
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
