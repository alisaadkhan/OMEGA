import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { BadgeCheck, MapPin, ShieldCheck } from "lucide-react";
import { apiRequest } from "../../api/client";
import { formatCount, formatEr, initialsAvatar } from "../../api/search-mapping";

const showcaseSchema = z.object({
  creators: z.array(
    z.object({
      displayName: z.string(),
      handle: z.string(),
      platform: z.enum(["instagram", "tiktok", "youtube"]),
      avatarUrl: z.string().nullable(),
      city: z.string().nullable(),
      niches: z.array(z.string()),
      followers: z.number().nullable(),
      engagementRate: z.number().nullable(),
      authenticityScore: z.number().nullable(),
      verified: z.boolean(),
    }),
  ),
});
type ShowcaseCreator = z.infer<typeof showcaseSchema>["creators"][number];
const PLATFORM: Record<ShowcaseCreator["platform"], string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

function Card({ c }: { c: ShowcaseCreator }) {
  return (
    <article className="flex w-[260px] shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-navy-3/80 p-5 text-left transition-colors hover:border-cyan/40">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={c.avatarUrl ?? initialsAvatar(c.displayName)}
              onError={(e) => { e.currentTarget.src = initialsAvatar(c.displayName); }}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-11 w-11 shrink-0 rounded-full border border-white/20 object-cover"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-sm font-bold text-white">
                <span className="truncate">{c.displayName}</span>
                {c.verified && <BadgeCheck className="h-4 w-4 shrink-0 fill-cyan-400 text-navy-3" aria-label={`Verified on ${PLATFORM[c.platform]}`} />}
              </div>
              <span className="block truncate text-xs text-slate-400">@{c.handle}</span>
            </div>
          </div>
          {c.authenticityScore !== null && (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-cyan/40 bg-cyan-950/80 px-2 py-1 text-[11px] font-bold text-cyan-300" title="Authenticity: how real the audience and engagement look (0–100)">
              <ShieldCheck className="h-3 w-3" /> {c.authenticityScore}
            </span>
          )}
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-slate-400">
          {c.city && (<><MapPin className="h-3 w-3 shrink-0 text-cyan-400" /><span className="truncate">{c.city}</span><span>•</span></>)}
          <span className="truncate">{c.niches.slice(0, 2).join(" · ") || "Creator"}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">
        <div><span className="block text-[10px] font-medium uppercase text-slate-400">Followers</span><span className="text-sm font-bold text-white">{formatCount(c.followers)}</span></div>
        <div><span className="block text-[10px] font-medium uppercase text-slate-400">Eng. Rate</span><span className="text-sm font-bold text-cyan-400">{c.engagementRate === null ? "—" : formatEr(c.engagementRate)}</span></div>
        <div><span className="block text-[10px] font-medium uppercase text-slate-400">Platform</span><span className="text-sm font-bold text-emerald-400">{PLATFORM[c.platform]}</span></div>
      </div>
    </article>
  );
}

/**
 * Real creators from the catalogue on the landing page (owner, 23 Nov: "a wheel that keeps scrolling itself"): the best
 * customer-visible creators by engagement and authenticity, a few per niche. The row loops by rendering the list twice.
 */
export function LandingShowcase() {
  const q = useQuery({ queryKey: ["public", "showcase"], queryFn: () => apiRequest("/v1/public/creators/showcase", showcaseSchema), staleTime: 10 * 60_000 });
  const creators = q.data?.creators ?? [];
  if (q.isError || (q.isSuccess && creators.length === 0)) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-navy-2 py-6 shadow-2xl sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2 px-6 sm:px-8">
        <div>
          <h2 className="text-base font-bold text-white sm:text-lg">Creators on MUSHIN right now</h2>
          <p className="text-xs text-slate-400">Real profiles from our catalogue, chosen for strong engagement from real audiences.</p>
        </div>
      </div>
      {q.isPending ? (
        <div className="flex gap-4 px-6 sm:px-8">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[170px] w-[260px] shrink-0 animate-pulse rounded-2xl bg-white/5" />)}</div>
      ) : (
        <div className="marquee overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]" tabIndex={0} role="region" aria-label="Creators on MUSHIN, scrolling. Hover or focus to pause.">
          <div className="marquee-track flex w-max gap-4 px-2" style={{ ["--marquee-duration" as string]: `${Math.max(30, creators.length * 5)}s` }}>
            {[...creators, ...creators].map((c, i) => <div key={`${c.handle}-${i}`} aria-hidden={i >= creators.length}><Card c={c} /></div>)}
          </div>
        </div>
      )}
    </div>
  );
}
