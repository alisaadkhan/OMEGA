import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { adminRequest } from "../../admin/adminApi";
import { ErrorState, LoadingBlock } from "../dashboard/states";
import { itemSchema, ReviewCard } from "../admin/CatalogueReview";
import { Badge, Empty, PageHeader, SearchInput, errText, fmtNum } from "./kit";

const listSchema = z.object({ items: z.array(itemSchema.extend({ eligible: z.boolean(), hiddenBecause: z.array(z.string()) })), total: z.number() });

/** Why a creator is not in customer search, in plain words (the eligibility reasons the catalogue records). */
const HIDDEN: Record<string, string> = {
  below_follower_minimum: "under 10,000 followers",
  followers_unknown: "follower count unknown",
  followers_stale: "follower count older than 90 days",
  inactive: "no post in 90 days",
  invalid_profile_url: "not an own profile link",
  profile_not_found: "profile not found",
  profile_private: "private profile",
  no_profile: "no profile",
  minor_protected: "possible minor",
  account_not_individual_creator: "not an individual creator",
  creator_not_active: "removed or merged",
  country_unknown: "country unknown",
  country_conflicting: "conflicting country",
  country_not_pakistan: "not in Pakistan",
  country_stale: "country evidence out of date",
};

/**
 * Creators (owner, 22 Nov: see the whole system from the console): every creator in the catalogue, found by name or
 * handle, largest first; whether customers can find them and why not; and the fixes staff may make (country from
 * evidence, a person wrongly taken for an organisation, a cleared minor flag). Every fix is audited.
 */
export function CreatorsPage({ canDecide }: { canDecide: boolean }) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(text.trim()); setOffset(0); }, 350);
    return () => window.clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: ["admin", "catalogue", q, offset],
    queryFn: () => adminRequest(`/admin/v1/catalogue/creators?q=${encodeURIComponent(q)}&offset=${offset}`, listSchema),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Creators" title="Catalogue" sub="Every creator MUSHIN holds, largest first. Search by name or handle; fixes are recorded in the audit log." />
      <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm"><SearchInput value={text} onChange={setText} placeholder="Search creators by name or @handle…" label="Search creators" /></div>
      {list.isPending ? <LoadingBlock lines={6} /> : list.isError ? <ErrorState body={errText(list.error)} onRetry={() => void list.refetch()} /> : list.data.items.length === 0 ? <Empty title="No creator matches" /> : (
        <>
          <p className="text-xs text-slate-500">{fmtNum(list.data.total)} creator{list.data.total === 1 ? "" : "s"}{q ? ` matching “${q}”` : " in the catalogue"} · showing {offset + 1}–{offset + list.data.items.length}</p>
          <div className={`space-y-3 ${list.isFetching ? "opacity-60" : ""}`}>
            {list.data.items.map((c) => (
              <ReviewCard
                key={c.id}
                item={c}
                kind="any"
                canDecide={canDecide}
                extra={c.eligible ? <Badge tone="emerald" dot>In customer search</Badge> : <Badge tone="amber" dot>Hidden from search{c.hiddenBecause.length ? `: ${c.hiddenBecause.map((r) => HIDDEN[r] ?? r.replace(/_/g, " ")).join(", ")}` : ""}</Badge>}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Previous</button>
            <button type="button" disabled={offset + list.data.items.length >= list.data.total} onClick={() => setOffset(offset + 50)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Next</button>
          </div>
        </>
      )}
    </div>
  );
}
