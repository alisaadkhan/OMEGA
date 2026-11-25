import { engagementScore, scoreTier, SCORE_TIER_LABEL, type ScorePlatform, type ScoreTier } from "@mushin/contracts";
import { formatEr } from "../../api/search-mapping";

/** Tier colours (owner, 25 Nov): Top 10% / Strong cyan, Typical soft indigo, Low muted slate. */
const TIER_CHIP: Record<ScoreTier, string> = {
  top: "bg-[#06B6D4] text-white",
  strong: "bg-cyan-100 text-cyan-800",
  typical: "bg-indigo-50 text-indigo-700",
  low: "bg-slate-100 text-slate-600",
  unknown: "bg-slate-100 text-slate-500",
};

/**
 * The headline engagement figure: the 1.0–10.0 Engagement Score with its tier, and the measured per-follower rate
 * underneath for transparency ("0.42% per subscriber"). Size "sm" for cards, "md" for the profile panel.
 */
export function EngagementScore({ rate, platform, size = "sm" }: { rate: number | null; platform: ScorePlatform; size?: "sm" | "md" }) {
  const score = engagementScore(rate, platform);
  const tier = scoreTier(score);
  const per = platform === "youtube" ? "subscriber" : "follower";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-1.5">
        {score === null ? (
          <span className={`${size === "md" ? "text-[15px]" : "text-[13px]"} font-bold text-slate-500`}>—</span>
        ) : (
          <span className={`${size === "md" ? "text-[18px]" : "text-lg"} font-bold leading-none tabular-nums text-slate-900`}>
            {score.toFixed(1)}
            <span className="text-[11px] font-semibold text-slate-400"> / 10</span>
          </span>
        )}
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_CHIP[tier]}`}>{SCORE_TIER_LABEL[tier]}</span>
      </div>
      {rate !== null && <div className="mt-1 text-[10.5px] tabular-nums text-slate-500">{formatEr(rate)} per {per}</div>}
    </div>
  );
}
