/** Shared SYNTHETIC catalogue for the Brain 1 acceptance suites (v1 and v2 run against identical data). */
import type { Synthetic } from "./harness";

/** Catalogue design (all SYNTHETIC). R = eligible, adult, Food niche, Lahore. */
export const CATALOGUE: Record<string, Synthetic> = {
  F1: { name: "Creator F1", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "Food vlogger reviewing street food and restaurants in Lahore", followers: 120_000 },
  F2: { name: "Creator F2", platform: "youtube", city: "Lahore", niches: ["Food"], bio: "Restaurant reviews and desi khana", followers: 60_000 },
  F3: { name: "Creator F3", platform: "tiktok", city: "Lahore", niches: ["Food"], bio: "لاہور کا کھانا street food", followers: 45_000 },
  F4: { name: "Creator F4", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "Food blogger Lahore", followers: 8_000 },
  F5: { name: "Creator F5", platform: "instagram", city: "Karachi", niches: ["Food"], bio: "Karachi food vlogger", followers: 70_000 },
  F6: { name: "Creator F6", platform: "instagram", city: "Lahore", niches: ["Fashion"], bio: "Fashion stylist", followers: 80_000 },
  F7: { name: "Creator F7", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "Food vlogger", followers: 50_000, isMinor: true },
  F8: { name: "Creator F8", platform: "youtube", city: "Lahore", niches: ["Food"], bio: "food channel", followers: 900_000 },
  F9: { name: "Creator F9", platform: "instagram", city: "Islamabad", niches: ["Tech"], bio: "Gadget reviews", followers: 30_000 },
  F10: { name: "Creator F10", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "home cooking recipes", followers: 25_000 },
  F11: { name: "Creator F11", platform: "instagram", city: "Lahore", niches: ["Beauty"], bio: "skin care routine every day", followers: 40_000 },
  F12: { name: "Creator F12", platform: "instagram", city: "Lahore", niches: ["Lifestyle"], bio: "skin tips, and I take good care of my plants", followers: 40_000 },
  F13: { name: "Ayesha Siddiqui", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "Baking and desserts", followers: 33_000 },
  F14: { name: "Creator F14", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "Food reviews", followers: 52_000, contacts: [{ kind: "email", value: "f14@synthetic.invalid", trust: "verified", source: "bio" }] },
  F15: { name: "Creator F15", platform: "instagram", city: "Lahore", niches: ["Food"], bio: "Food vlogger", followers: 48_000, extraProfiles: [{ platform: "tiktok", followers: 41_000 }] },
};
export const R = ["F1", "F2", "F3", "F8", "F10", "F13", "F14", "F15"];
