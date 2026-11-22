import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { apiRequest } from "../../api/client";
import { formatCount, formatEr, initialsAvatar } from "../../api/search-mapping";
import { useAuth } from "../../auth/AuthContext";
import { Skeleton } from "../../ui/kit";
import type { Creator } from "./CreatorProfilePanel";

const featuredSchema = z.object({
  creators: z.array(
    z.object({
      id: z.string(),
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
      hasContact: z.boolean(),
    }),
  ),
});
type Featured = z.infer<typeof featuredSchema>["creators"][number];
const PLATFORM: Record<Featured["platform"], string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

const toCreator = (c: Featured): Creator => ({
  id: c.id,
  handle: c.handle,
  name: c.displayName,
  avatar: c.avatarUrl ?? initialsAvatar(c.displayName),
  platform: c.platform,
  city: c.city ?? "",
  niche: c.niches.join(" · "),
  followers: formatCount(c.followers),
  followersNum: c.followers,
  engagement: c.engagementRate,
  engagementNote: null,
  authenticity: c.authenticityScore,
  fake: null,
  score: 0,
  fitLabel: "",
  verified: c.verified,
  posts: 0,
  avgLikes: "—",
  avgComments: "—",
  followersFreshness: "unknown",
  hasContact: c.hasContact,
  contactAvailability: null,
});

/**
 * A scrolling row of a few of the best creators (owner, 22 Nov: "best creators, not top in followers"): real catalogue
 * creators ranked by engagement weighted by authenticity, varied by niche. Opening one costs nothing.
 */
export function FeaturedCreators({ onOpenCreator }: { onOpenCreator: (c: Creator) => void }) {
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["creators", "featured"], queryFn: () => apiRequest("/v1/creators/featured", featuredSchema), enabled: status === "signedIn", staleTime: 10 * 60_000 });
  if (q.isError || (q.data && q.data.creators.length === 0)) return null;
  return (
    <section className="mb-8" aria-label="Creators worth a look">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#0B112B]">Creators worth a look</h2>
          <p className="text-xs text-ink-soft">Strong engagement from real audiences, across different niches. Not ranked by follower count.</p>
        </div>
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" tabIndex={0} role="region" aria-label="Featured creators, scroll sideways">
        {q.isPending
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[150px] w-[220px] shrink-0 rounded-2xl" />)
          : q.data.creators.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCreator(toCreator(c))}
                className="flex w-[220px] shrink-0 snap-start flex-col gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600"
              >
                <div className="flex items-center gap-3">
                  <img src={c.avatarUrl ?? initialsAvatar(c.displayName)} alt="" className="h-11 w-11 shrink-0 rounded-full bg-slate-100 object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 truncate text-sm font-semibold text-slate-900">
                      <span className="truncate">{c.displayName}</span>
                      {c.verified && <ShieldCheck aria-label="Verified" className="h-3.5 w-3.5 shrink-0 text-[#06B6D4]" />}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">@{c.handle} · {PLATFORM[c.platform]}</div>
                  </div>
                </div>
                <div className="truncate text-[11px] text-slate-600">{[c.niches[0], c.city].filter(Boolean).join(" · ") || " "}</div>
                <div className="grid grid-cols-3 gap-1 text-center">
                  <Stat label="Engagement" value={c.engagementRate === null ? "—" : formatEr(c.engagementRate)} accent />
                  <Stat label="Followers" value={formatCount(c.followers)} />
                  <Stat label="Real" value={c.authenticityScore === null ? "—" : `${c.authenticityScore}%`} />
                </div>
              </button>
            ))}
      </div>
    </section>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1 py-1.5">
      <div className={`text-[13px] font-bold tabular-nums ${accent ? "text-cyan-700" : "text-slate-900"}`}>{value}</div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}
