import { BadgeCheck } from "lucide-react";

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

/**
 * The platform's own blue tick (owner, 18 Nov): shown only when the platform marks the account verified (the scraper's
 * verified flag on one of the creator's profiles). Never for MUSHIN's assessment, a complete profile or a contact
 * check; an unknown status shows nothing. A filled blue rosette with a white check, like the platforms' own badge.
 */
export function VerifiedBadge({ platform, size = "md" }: { platform?: string | null; size?: "sm" | "md" }) {
  const where = platform ? PLATFORM_NAME[platform] : undefined;
  const label = where ? `Verified on ${where}` : "Verified account";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center">
      <BadgeCheck aria-hidden className={`${size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"} fill-[#1D9BF0] text-white`} strokeWidth={2.25} />
    </span>
  );
}
