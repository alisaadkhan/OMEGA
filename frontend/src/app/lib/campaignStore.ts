import { useSyncExternalStore } from "react";
import { profiles } from "../auth/profiles";

export type CampaignStatus = "draft" | "active" | "paused" | "completed";
export type Platform = "instagram" | "tiktok" | "youtube" | "mixed";
export type PipelineStage = "identified" | "contacted" | "negotiating" | "confirmed";
export type ContentStatus = "none" | "content_pending" | "posted" | "completed" | "declined";
export type FeeKind = "estimated" | "quoted" | "agreed";

export type CampaignCreator = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  platform: Exclude<Platform, "mixed">;
  followers: string;
  authenticity: number;
  fee: string;
  stage: PipelineStage;
  contentStatus: ContentStatus;
  priority: "low" | "med" | "high";
  due: string;
  addedAt: string;
};

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  platform: Platform;
  budget: number;
  spent: number;
  creators: CampaignCreator[];
  owner: string;
  ownerAvatar: string;
  startDate: string;
  endDate: string;
  goal: string;
  client?: string;
  objective?: string;
  criteria?: string;
};

export const STAGES: { id: PipelineStage; label: string }[] = [
  { id: "identified", label: "Identified" },
  { id: "contacted", label: "Contacted" },
  { id: "negotiating", label: "Negotiating" },
  { id: "confirmed", label: "Confirmed" },
];

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

export const feeKindFor = (s: PipelineStage): FeeKind =>
  s === "confirmed" ? "agreed" : s === "negotiating" ? "quoted" : "estimated";

export const FEE_LABEL: Record<FeeKind, string> = {
  estimated: "Estimated fee",
  quoted: "Quoted fee",
  agreed: "Agreed fee",
};

type P = keyof typeof profiles;

const c = (
  id: string,
  p: P,
  handle: string,
  platform: CampaignCreator["platform"],
  followers: string,
  authenticity: number,
  fee: string,
  stage: PipelineStage,
  contentStatus: ContentStatus,
  priority: CampaignCreator["priority"],
  due: string,
  addedAt: string,
): CampaignCreator => ({
  id,
  name: (profiles[p] as { name: string }).name,
  handle,
  avatar: profiles[p].avatar,
  platform,
  followers,
  authenticity,
  fee,
  stage,
  contentStatus,
  priority,
  due,
  addedAt,
});

const seed: Campaign[] = [
  {
    id: "cmp-1",
    name: "Eid Sale 2026",
    status: "active",
    platform: "mixed",
    budget: 1500000,
    spent: 920000,
    creators: [
      c("cr-1", "ayesha", "ayeshamalik", "instagram", "684K", 88, "Rs. 85K", "confirmed", "posted", "high", "Jul 04", "2026-06-20"),
      c("cr-2", "sana", "sanaa.k", "instagram", "412K", 92, "Rs. 62K", "confirmed", "content_pending", "high", "Jul 06", "2026-06-20"),
      c("cr-3", "usman", "usmantariq", "tiktok", "2.4M", 82, "Rs. 180K", "confirmed", "none", "high", "Jul 08", "2026-06-22"),
      c("cr-4", "fahad", "fahad.q", "youtube", "1.2M", 94, "Rs. 220K", "negotiating", "none", "med", "Jul 12", "2026-06-23"),
      c("cr-5", "hira", "hira.sheikh", "instagram", "228K", 90, "Rs. 40K", "contacted", "none", "med", "Jul 14", "2026-06-25"),
      c("cr-6", "bilal", "bilalhussain", "youtube", "512K", 91, "Rs. 95K", "identified", "none", "low", "—", "2026-06-27"),
      c("cr-7", "zainab", "zainab.iqbal", "instagram", "184K", 93, "Rs. 32K", "identified", "none", "low", "—", "2026-06-27"),
    ],
    owner: "Ahmed Raza Khan",
    ownerAvatar: profiles.ahmed.avatar,
    startDate: "2026-06-20",
    endDate: "2026-07-20",
    goal: "Drive 2M reach and 40k landing-page visits for the Eid capsule.",
  },
  {
    id: "cmp-2",
    name: "Ramadan Beauty Drop",
    status: "active",
    platform: "instagram",
    budget: 750000,
    spent: 410000,
    creators: [],
    owner: "Sana Riaz",
    ownerAvatar: profiles.sana.avatar,
    startDate: "2026-06-12",
    endDate: "2026-07-08",
    goal: "Position new lip-oil range with beauty micro-creators.",
  },
  {
    id: "cmp-3",
    name: "Festive Bridal '26",
    status: "draft",
    platform: "instagram",
    budget: 2000000,
    spent: 0,
    creators: [],
    owner: "Hira Sheikh",
    ownerAvatar: profiles.hira.avatar,
    startDate: "2026-07-15",
    endDate: "2026-09-15",
    goal: "Kick off pre-wedding capsule for Heritage Lahore.",
  },
  {
    id: "cmp-4",
    name: "FreshFit Q3 Launch",
    status: "paused",
    platform: "youtube",
    budget: 600000,
    spent: 82000,
    creators: [],
    owner: "Bilal Hussain",
    ownerAvatar: profiles.bilal.avatar,
    startDate: "2026-06-05",
    endDate: "2026-08-30",
    goal: "Long-form product reviews for activewear launch.",
  },
];

let campaigns: Campaign[] = seed;
const listeners = new Set<() => void>();

export const getCampaigns = () => campaigns;

export function setCampaigns(next: Campaign[] | ((prev: Campaign[]) => Campaign[])) {
  campaigns = typeof next === "function" ? next(campaigns) : next;
  listeners.forEach((l) => l());
}

export function useCampaigns() {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getCampaigns);
}

export const confirmedCount = (cmp: Campaign) => cmp.creators.filter((x) => x.stage === "confirmed").length;

export const stageCounts = (list: Campaign[]) =>
  STAGES.map((s) => ({
    ...s,
    count: list.reduce((n, cmp) => n + cmp.creators.filter((x) => x.stage === s.id).length, 0),
  }));

export const totalCreators = (list: Campaign[]) => list.reduce((n, cmp) => n + cmp.creators.length, 0);

export const progressLabel = (cmp: Campaign) =>
  cmp.creators.length === 0
    ? "No creators added yet"
    : `${confirmedCount(cmp)} of ${cmp.creators.length} creators confirmed`;

export const progressRatio = (cmp: Campaign) =>
  cmp.creators.length === 0 ? 0 : confirmedCount(cmp) / cmp.creators.length;

export const formatDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
