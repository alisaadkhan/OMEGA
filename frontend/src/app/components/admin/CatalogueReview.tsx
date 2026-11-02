import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ExternalLink } from "lucide-react";
import { adminRequest } from "../../admin/adminApi";
import { useToast } from "../../lib/toast";

type Kind = "country" | "minor" | "assessment";

const itemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  publicCountry: z.string().nullable(),
  publicCountrySource: z.string().nullable(),
  isMinor: z.boolean(),
  minorReason: z.string().nullable(),
  assessmentStatus: z.string().nullable(),
  profiles: z.array(
    z.object({
      platform: z.string(),
      handle: z.string(),
      url: z.string(),
      followers: z.number().nullable(),
      countryStatus: z.string().nullable(),
      country: z.string().nullable(),
      countrySource: z.string().nullable(),
      bio: z.string().nullable(),
    }),
  ),
});
const listSchema = z.object({ items: z.array(itemSchema), total: z.number(), counts: z.object({ country: z.number(), minor: z.number(), assessment: z.number() }) });
type Item = z.infer<typeof itemSchema>;

const TABS: { id: Kind; label: string; hint: string }[] = [
  { id: "country", label: "Country unknown", hint: "Profiles with 5,000+ followers whose country is unknown or conflicting. Hidden from search until a Pakistani profile is confirmed." },
  { id: "minor", label: "Possible minors", hint: "Creators flagged as possibly under 18. Contacts and outreach stay locked until a staff member clears the flag with a reason." },
  { id: "assessment", label: "Awaiting assessment", hint: "Creators with 5,000+ followers whose AI assessment is pending or had too little data." },
];

const fmt = (n: number | null) => (n === null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n));
const STATUS_STYLE: Record<string, string> = {
  pakistan: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  foreign: "bg-rose-50 text-rose-700 ring-rose-200",
  conflicting: "bg-amber-50 text-amber-700 ring-amber-200",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200",
};

/**
 * Catalogue review (owner directive 2026-11-03): everyone can see the queue; Admins set a country from evidence (a public
 * record, never a guess from a name or a face) or clear a possible-minor flag. The API audits each decision and search
 * updates on its own.
 */
export function CatalogueReview({ canDecide }: { canDecide: boolean }) {
  const [kind, setKind] = useState<Kind>("country");
  const [pages, setPages] = useState(1);
  const list = useQuery({
    queryKey: ["admin", "catalogue-review", kind, pages],
    queryFn: async () => {
      const all = await Promise.all(Array.from({ length: pages }, (_, i) => adminRequest(`/admin/v1/catalogue/review?kind=${kind}&offset=${i * 50}`, listSchema)));
      return { ...all[all.length - 1]!, items: all.flatMap((p) => p.items) };
    },
  });
  const tab = TABS.find((t) => t.id === kind)!;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-slate-900" style={{ fontSize: 16, fontWeight: 600 }}>Catalogue review</h2>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Review queue">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={kind === t.id}
              onClick={() => {
                setKind(t.id);
                setPages(1);
              }}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${kind === t.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
            >
              {t.label}
              {list.data && <span className="ml-1.5 tabular-nums opacity-70">{list.data.counts[t.id].toLocaleString()}</span>}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">{tab.hint}</p>
      {list.isPending && <p className="text-xs text-slate-500">Loading…</p>}
      {list.isError && <p className="text-xs text-rose-700">{list.error instanceof Error ? list.error.message : "Couldn't load the review queue."}</p>}
      {list.data?.items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-500">Nothing to review here.</p>}
      <div className="space-y-3">
        {list.data?.items.map((item) => <ReviewCard key={item.id} item={item} kind={kind} canDecide={canDecide} />)}
      </div>
      {list.data && list.data.items.length < list.data.total && (
        <button onClick={() => setPages((p) => p + 1)} disabled={list.isFetching} className="rounded-md bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
          {list.isFetching ? "Loading…" : `Show more (${(list.data.total - list.data.items.length).toLocaleString()} left)`}
        </button>
      )}
    </div>
  );
}

function ReviewCard({ item, kind, canDecide }: { item: Item; kind: Kind; canDecide: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [country, setCountry] = useState("PK");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const done = () => void qc.invalidateQueries({ queryKey: ["admin", "catalogue-review"] });
  const setCountryMut = useMutation({
    mutationFn: () => adminRequest(`/admin/v1/catalogue/creators/${item.id}/country`, z.object({ changed: z.array(z.object({ platform: z.string(), to: z.string() })) }), { method: "POST", body: { country, evidence } }),
    onSuccess: (r) => {
      toast.success(`Country set for ${item.displayName}`, r.changed.length ? r.changed.map((c) => `${c.platform}: ${c.to}`).join(" · ") : "No profile changed; a stated life abroad still wins.");
      done();
    },
    onError: (e) => toast.error("Couldn't set the country", e instanceof Error ? e.message : undefined),
  });
  const clearMinor = useMutation({
    mutationFn: () => adminRequest(`/admin/v1/catalogue/creators/${item.id}/minor-override`, z.object({ cleared: z.literal(true) }), { method: "POST", body: { reason } }),
    onSuccess: () => {
      toast.success(`Cleared the minor flag for ${item.displayName}`);
      done();
    },
    onError: (e) => toast.error("Couldn't clear the flag", e instanceof Error ? e.message : undefined),
  });
  const countryOk = /^[A-Za-z]{2}$/.test(country.trim()) && evidence.trim().length >= 12;
  const reasonOk = reason.trim().length >= 12;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-sm">
      <div className="flex items-start gap-3">
        <img src={item.avatarUrl ?? ""} alt="" className="h-10 w-10 shrink-0 rounded-full bg-slate-100 object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-900" style={{ fontWeight: 600 }}>{item.displayName}</span>
            {item.city && <span className="text-slate-500">{item.city}</span>}
            {item.publicCountry && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600" title={item.publicCountrySource ?? ""}>Public record: {item.publicCountry}</span>}
            {item.isMinor && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 ring-1 ring-amber-200">Possible minor{item.minorReason ? `: ${item.minorReason}` : ""}</span>}
            {kind === "assessment" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{item.assessmentStatus === "insufficient_data" ? "Too little data" : item.assessmentStatus ?? "Not assessed"}</span>}
          </div>
          <ul className="mt-2 space-y-2">
            {item.profiles.map((p) => (
              <li key={`${p.platform}:${p.handle}`} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={p.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-cyan-700 hover:underline">
                    {p.platform} @{p.handle} <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                  <span className="tabular-nums text-slate-600">{fmt(p.followers)} followers</span>
                  {p.countryStatus && <span className={`rounded px-1.5 py-0.5 ring-1 ${STATUS_STYLE[p.countryStatus] ?? STATUS_STYLE["unknown"]}`}>{p.countryStatus}{p.country ? ` · ${p.country}` : ""}</span>}
                </div>
                {p.bio && <p className="mt-1 whitespace-pre-line text-slate-600">{p.bio}</p>}
              </li>
            ))}
          </ul>
          {canDecide && kind !== "minor" && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (countryOk) setCountryMut.mutate();
              }}
            >
              <label className="sr-only" htmlFor={`cc-${item.id}`}>Country code</label>
              <input id={`cc-${item.id}`} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} className="w-14 rounded-md border border-slate-200 px-2 py-1.5 text-center uppercase" aria-describedby={`ev-hint-${item.id}`} />
              <label className="sr-only" htmlFor={`ev-${item.id}`}>Evidence</label>
              <input id={`ev-${item.id}`} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence: a link or a short note (where this comes from)" className="min-w-[240px] flex-1 rounded-md border border-slate-200 px-2 py-1.5" />
              <button type="submit" disabled={!countryOk || setCountryMut.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-50">
                {setCountryMut.isPending ? "Saving…" : country.trim().toUpperCase() === "PK" ? "Confirm Pakistan" : `Set ${country.trim().toUpperCase() || "country"}`}
              </button>
              <span id={`ev-hint-${item.id}`} className="w-full text-[11px] text-slate-500">Never from a name, a face or a language: only from a source you can point to. A country other than PK hides the creator from search.</span>
            </form>
          )}
          {canDecide && kind === "minor" && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (reasonOk) clearMinor.mutate();
              }}
            >
              <label className="sr-only" htmlFor={`mr-${item.id}`}>Reason</label>
              <input id={`mr-${item.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this creator is an adult (source)" className="min-w-[240px] flex-1 rounded-md border border-slate-200 px-2 py-1.5" />
              <button type="submit" disabled={!reasonOk || clearMinor.isPending} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-50">
                {clearMinor.isPending ? "Saving…" : "Clear minor flag"}
              </button>
            </form>
          )}
        </div>
      </div>
    </article>
  );
}
