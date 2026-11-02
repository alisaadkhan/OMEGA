import { motion } from "motion/react";
import { ArrowRight, BadgeCheck, Ban, Bookmark, Check, Clock, Instagram, Mail, MapPin, Music2, Phone, Star, Youtube } from "lucide-react";
import { CONTACT_AVAILABILITY_TEXT, matchSummary } from "../../api/search-mapping";
import { FreshnessBadge } from "./states";
import type { Creator } from "./CreatorProfilePanel";

const PLATFORM = {
  instagram: { Icon: Instagram, label: "Instagram", color: "text-rose-300" },
  tiktok: { Icon: Music2, label: "TikTok", color: "text-white" },
  youtube: { Icon: Youtube, label: "YouTube", color: "text-red-400" },
} as const;

/**
 * Search result card: photo first (platform and fit score over it), then name, handle, place and niche, the two
 * headline figures, the honesty markers (why it matched, freshness, contact) and the actions. Every value is the
 * creator's stored record; an unknown figure shows as "—", never as zero.
 */
export function SearchCreatorCard({
  creator,
  index,
  selected,
  onSelect,
  onOpen,
  onShortlist,
}: {
  creator: Creator;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onShortlist: () => void;
}) {
  const contact = creator.contactAvailability ?? (creator.hasContact ? "email_unverified" : "none");
  const contactText = CONTACT_AVAILABILITY_TEXT[contact];
  const ContactIcon = contact === "email_invalid" ? Ban : contact === "phone_unverified" ? Phone : contact === "none" ? Clock : Mail;
  const plat = PLATFORM[creator.platform];
  const matched = matchSummary(creator.matchedOn);
  const place = [creator.city, creator.niche].filter((x) => x && x !== "Unknown").join(" • ");
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(index, 12) * 0.03, ease: "easeOut" }}>
      <div
        className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${
          selected ? "border-[#06B6D4] ring-2 ring-[#06B6D4]/25" : "border-slate-200/80"
        }`}
      >
        <div className="relative aspect-[4/4.4] w-full overflow-hidden bg-slate-100">
          <button type="button" onClick={onOpen} tabIndex={-1} aria-hidden className="block h-full w-full">
            {creator.avatar.startsWith("data:") ? (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-cyan-50">
                <img src={creator.avatar} alt="" className="h-20 w-20 rounded-full ring-4 ring-white" />
              </div>
            ) : (
              <img src={creator.avatar} alt="" loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-105" />
            )}
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
          </button>
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={onSelect}
            aria-label={`Select ${creator.name}`}
            className={`absolute left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg border shadow-sm backdrop-blur-md transition-colors focus:outline-none focus:ring-2 focus:ring-[#06B6D4] ${
              selected ? "border-[#0A0F24] bg-[#0A0F24] text-white" : "border-white/50 bg-white/70 text-transparent hover:bg-white/90"
            }`}
          >
            <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
          </button>
          {creator.score > 0 && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-white/20 bg-slate-900/60 px-2.5 py-1 text-xs font-semibold tracking-wide text-white shadow-sm backdrop-blur-md" title="How well this creator fits your search">
              <Star aria-hidden className="h-3 w-3 fill-[#06B6D4] text-[#06B6D4]" />
              Fit {creator.score}
            </span>
          )}
          <span className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] font-medium tracking-wide text-white backdrop-blur-md">
            <plat.Icon aria-hidden className={`h-3 w-3 ${plat.color}`} strokeWidth={2.25} />
            {plat.label}
          </span>
        </div>

        <div className="flex flex-1 flex-col justify-between p-5">
          <button type="button" onClick={onOpen} className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#06B6D4]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-base font-bold tracking-tight text-slate-900 transition-colors group-hover:text-teal-700">{creator.name}</span>
              {creator.verified && <BadgeCheck aria-label="Verified" className="h-4 w-4 shrink-0 text-[#06B6D4]" />}
            </span>
            <span className="mb-2 block text-xs font-medium text-slate-500">@{creator.handle}</span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{place || "Place and niche not known yet"}</span>
            </span>
          </button>

          <div className="mt-4">
            <dl className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div>
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{creator.platform === "youtube" ? "Subscribers" : "Followers"}</dt>
                <dd className="text-lg font-bold leading-none tabular-nums text-slate-900">{creator.followers}</dd>
              </div>
              <div className="border-l border-slate-200/60 pl-3">
                <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Eng. rate</dt>
                <dd className="text-lg font-bold leading-none tabular-nums text-cyan-700" title={creator.engagement === null ? "Not known for this creator" : undefined}>
                  {creator.engagement === null ? "—" : `${creator.engagement.toFixed(1)}%`}
                </dd>
              </div>
            </dl>
            {matched && (
              <p className="mb-2 line-clamp-2 text-[11px] leading-4 text-slate-500" data-testid="match-reasons">
                <span className="font-medium text-slate-700">Matched: </span>
                {matched}
              </p>
            )}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <FreshnessBadge value={creator.followersFreshness} />
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  contact === "email_invalid" ? "border-rose-100 bg-rose-50 text-rose-700" : contact === "none" ? "border-slate-200 bg-slate-50 text-slate-600" : "border-cyan-100 bg-cyan-50 text-cyan-800"
                }`}
                title={contactText.title}
              >
                <ContactIcon aria-hidden className="h-3 w-3" strokeWidth={2} />
                {contactText.label}
              </span>
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <button onClick={onOpen} className="group/btn flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0A0F24] px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/50 disabled:opacity-50">
                View Profile
                <ArrowRight aria-hidden className="h-3.5 w-3.5 text-[#06B6D4] transition-transform group-hover/btn:translate-x-0.5" />
              </button>
              <button onClick={onShortlist} title="Save to shortlist" aria-label={`Save ${creator.name} to a shortlist`} className="rounded-xl border border-slate-200/70 p-2.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-[#06B6D4] focus:outline-none focus:ring-2 focus:ring-[#06B6D4]/50 disabled:opacity-50">
                <Bookmark aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
