import { randomUUID } from "node:crypto";
import { createLogger } from "@mushin/core";
import type { Db } from "@mushin/db";
import { createCreatorIndexer } from "./indexer";
import { insertCreator, type NewCreator, type NewProfile } from "./repository";

/** Encryption key for fixture contacts (tests only). */
export const TEST_KEY = Buffer.alloc(32, 9);

export function fixtureCreator(over: Partial<Omit<NewCreator, "profiles">> & { profiles?: Partial<NewProfile>[] } = {}): NewCreator {
  const handle = `creator_${randomUUID().slice(0, 8)}`;
  const { profiles, ...rest } = over;
  return {
    displayName: "Test Creator",
    primaryHandle: handle,
    primaryPlatform: "instagram",
    city: "Lahore",
    country: "PK",
    niches: ["Bridal"],
    tags: [],
    ...rest,
    profiles: (profiles ?? [{}]).map((p, i) => ({
      platform: "instagram",
      handle: i === 0 ? handle : `${handle}_${i}`,
      followers: 50_000,
      engagementRate: 5,
      bio: "Bridal makeup artist in Lahore",
      ...p,
    })),
  };
}

export function addCreator(db: Db, over: Parameters<typeof fixtureCreator>[0] = {}): Promise<string> {
  return db.withSystem((tx) => insertCreator(tx, fixtureCreator(over), TEST_KEY));
}

/** A fixture creator indexed as the worker would index it, so eligibility (elig-1) is evaluated (50,000 fresh followers by default). */
export async function addIndexedCreator(db: Db, over: Parameters<typeof fixtureCreator>[0] = {}): Promise<string> {
  const id = await addCreator(db, over);
  await createCreatorIndexer({ db, index: null, logger: createLogger({ level: "silent" }) }).sync([id]);
  return id;
}
