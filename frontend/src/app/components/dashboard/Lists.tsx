import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  Search,
  Star,
  MoreHorizontal,
  Users,
  Sparkles,
  TrendingUp,
  Filter,
  ArrowLeft,
  Download,
  Trash2,
  Copy,
  Share2,
  FolderPlus,
  Pencil,
  FolderInput,
  MessageSquare,
  Tag,
  MapPin,
} from "lucide-react";
import { profiles } from "../../auth/profiles";
import { useToast, useConfirm } from "../../lib/toast";

/**
 * LISTS module — spec:
 * home (stats + grid) + detail (creator table with bulk actions).
 */

type Creator = {
  id: string;
  name: string;
  avatar: string;
  platform: "instagram" | "tiktok" | "youtube";
  handle: string;
  followers: string;
  followersNum: number | null;
  auth: number;
  eng: number;
  quality: string;
  country: string;
  email: string;
  phone: string;
  added: string;
  campaign: string | null;
};

type List = {
  id: string;
  name: string;
  description: string;
  count: number;
  updated: string;
  owner: string;
  shared: boolean;
  favorite: boolean;
  tags: string[];
  avgAuth: number;
  reach: string;
  cover: string[];
  campaign: boolean;
  creators: Creator[];
};

const seedCreators: Creator[] = [
  { id: "c1", name: "Sana Riaz", avatar: profiles.sana.avatar, platform: "instagram", handle: "sanaa.k", followers: "412K", followersNum: 412000, auth: 92, eng: 5.2, quality: "High", country: "PK", email: "sanaa@studio.pk", phone: "+92 3•• ••• 42••", added: "2d", campaign: "Bridal Q3" },
  { id: "c2", name: "Ayesha Malik", avatar: profiles.ayesha.avatar, platform: "instagram", handle: "ayeshamalik", followers: "684K", followersNum: 684000, auth: 88, eng: 6.1, quality: "High", country: "PK", email: "ayesha@brandx.pk", phone: "+92 3•• ••• 91••", added: "5d", campaign: null },
  { id: "c3", name: "Hira Sheikh", avatar: profiles.hira.avatar, platform: "instagram", handle: "hira.sheikh", followers: "228K", followersNum: 228000, auth: 90, eng: 7.8, quality: "High", country: "PK", email: "hira@wedding.pk", phone: "+92 3•• ••• 18••", added: "1w", campaign: "Bridal Q3" },
];

const seedLists: List[] = [
  {
    id: "l1",
    name: "Bridal Lahore Q3",
    description: "Verified bridal-fashion creators shortlisted for the Heritage Lahore Q3 push.",
    count: 24,
    updated: "2h",
    owner: "Ahmed",
    shared: true,
    favorite: true,
    tags: ["bridal", "lahore", "q3"],
    avgAuth: 89,
    reach: "3.2M",
    cover: [profiles.ayesha.avatar, profiles.hira.avatar, profiles.sana.avatar, profiles.zainab.avatar],
    campaign: true,
    creators: seedCreators,
  },
  {
    id: "l2",
    name: "Karachi tech reviewers",
    description: "Long-form YouTube reviewers in Karachi & Islamabad with >100k subs.",
    count: 12,
    updated: "Yesterday",
    owner: "Bilal",
    shared: false,
    favorite: false,
    tags: ["tech", "karachi", "youtube"],
    avgAuth: 93,
    reach: "1.8M",
    cover: [profiles.fahad.avatar, profiles.usman.avatar, profiles.bilal.avatar, profiles.ahmed.avatar],
    campaign: false,
    creators: [],
  },
  {
    id: "l3",
    name: "Ramadan food creators",
    description: "Halal cooking & iftar content creators for the Ramadan drop.",
    count: 38,
    updated: "3d",
    owner: "Sana",
    shared: true,
    favorite: true,
    tags: ["food", "ramadan", "urdu"],
    avgAuth: 86,
    reach: "4.6M",
    cover: [profiles.zainab.avatar, profiles.hira.avatar, profiles.sana.avatar, profiles.ayesha.avatar],
    campaign: true,
    creators: [],
  },
  {
    id: "l4",
    name: "Comedy shortform",
    description: "TikTok Urdu comedy under 30s. Strong repeat-watch metrics.",
    count: 18,
    updated: "1w",
    owner: "Fahad",
    shared: false,
    favorite: false,
    tags: ["comedy", "tiktok"],
    avgAuth: 82,
    reach: "5.1M",
    cover: [profiles.usman.avatar, profiles.ahmed.avatar, profiles.fahad.avatar, profiles.bilal.avatar],
    campaign: false,
    creators: [],
  },
  {
    id: "l5",
    name: "Wellness · Islamabad",
    description: "Yoga, mindfulness, women-focused creators.",
    count: 9,
    updated: "2w",
    owner: "Ahmed",
    shared: false,
    favorite: false,
    tags: ["wellness", "islamabad"],
    avgAuth: 91,
    reach: "820K",
    cover: [profiles.zainab.avatar, profiles.hira.avatar, profiles.sana.avatar],
    campaign: false,
    creators: [],
  },
  {
    id: "l6",
    name: "Q4 exploratory",
    description: "Wildcard creator pool for Q4 experiments.",
    count: 0,
    updated: "just now",
    owner: "Ahmed",
    shared: false,
    favorite: false,
    tags: ["draft"],
    avgAuth: 0,
    reach: "—",
    cover: [],
    campaign: false,
    creators: [],
  },
];

export function Lists() {
  const [lists, setLists] = useState(seedLists);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  const open = openId ? lists.find((l) => l.id === openId) ?? null : null;

  const toggleFav = (id: string) => {
    setLists((prev) =>
      prev.map((l) => (l.id === id ? { ...l, favorite: !l.favorite } : l))
    );
  };

  const remove = async (id: string) => {
    const l = lists.find((x) => x.id === id);
    if (!l) return;
    const ok = await confirm({
      title: `Delete "${l.name}"?`,
      body: "This removes the list from your workspace. Creators inside are not deleted from Mushin.",
      destructive: true,
      confirmLabel: "Delete list",
    });
    if (ok) {
      setLists((prev) => prev.filter((x) => x.id !== id));
      toast.success("List deleted", `${l.name} was removed.`);
    }
  };

  const rename = (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name: clean, updated: "just now" } : l)));
    toast.success("List renamed", clean);
  };

  const duplicate = (id: string) => {
    const l = lists.find((x) => x.id === id);
    if (!l) return;
    const copy = { ...l, id: `${l.id}-copy-${Date.now()}`, name: `${l.name} (copy)`, updated: "just now" };
    setLists((prev) => [copy, ...prev]);
    toast.success("List duplicated", copy.name);
  };

  const createNew = () => {
    const n: List = {
      id: `l-${Date.now()}`,
      name: "Untitled list",
      description: "Add a description",
      count: 0,
      updated: "just now",
      owner: "You",
      shared: false,
      favorite: false,
      tags: [],
      avgAuth: 0,
      reach: "—",
      cover: [],
      campaign: false,
      creators: [],
    };
    setLists((prev) => [n, ...prev]);
    toast.success("New list created");
  };

  const filtered = lists.filter((l) =>
    !query || `${l.name} ${l.description} ${l.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())
  );

  if (open) {
    return <ListDetail list={open} allLists={lists} onBack={() => setOpenId(null)} onRename={(name) => rename(open.id, name)} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.025em" }}>
            Lists
          </h1>
          <p className="mt-1 text-sm text-slate-500">Save and organize creator shortlists across your workspace.</p>
        </div>
        <button
          onClick={createNew}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm text-white hover:-translate-y-px hover:bg-slate-800 hover:shadow-md transition-all"
          style={{ fontWeight: 500 }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New list
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total lists" value={String(lists.length)} icon={FolderPlus} />
        <Stat label="Total creators" value={lists.reduce((a, l) => a + l.count, 0).toLocaleString()} icon={Users} />
        <Stat label="Avg auth. signals" value={`${Math.round(lists.filter(l=>l.avgAuth).reduce((a,l)=>a+l.avgAuth,0) / Math.max(1, lists.filter(l=>l.avgAuth).length))}`} icon={Sparkles} />
        <Stat label="Est. reach" value="15.5M" icon={TrendingUp} />
        <Stat label="Updated today" value={String(lists.filter(l => l.updated.includes("h") || l.updated === "just now").length)} icon={Star} />
        <Stat label="Campaign-linked" value={String(lists.filter(l => l.campaign).length)} icon={Filter} />
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          <Filter className="h-3.5 w-3.5" /> Filters
        </button>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState onCreate={createNew} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              onOpen={() => setOpenId(l.id)}
              onToggleFav={() => toggleFav(l.id)}
              onDelete={() => remove(l.id)}
              onDuplicate={() => duplicate(l.id)}
              onRename={(name) => rename(l.id, name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" strokeWidth={2} />
        {label}
      </div>
      <div className="mt-1 tabular-nums text-slate-900" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

function ListCard({
  list,
  onOpen,
  onToggleFav,
  onDelete,
  onDuplicate,
  onRename,
}: {
  list: List;
  onOpen: () => void;
  onToggleFav: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: (name: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const commitRename = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== list.name) onRename(draft.trim());
    else setDraft(list.name);
  };
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md"
    >
      {/* Cover collage */}
      <button onClick={onOpen} className="block w-full">
        <div className="relative h-24 bg-gradient-to-br from-indigo-500/10 to-emerald-500/10">
          {list.cover.length > 0 ? (
            <div className="absolute inset-0 grid grid-cols-4 gap-0.5 p-2">
              {list.cover.slice(0, 4).map((a, i) => (
                <div key={i} className="overflow-hidden rounded-md bg-slate-100">
                  <img src={a} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
              <FolderPlus className="h-5 w-5" strokeWidth={1.5} />
            </div>
          )}
          {list.shared && (
            <span className="absolute right-2 top-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] text-slate-600 backdrop-blur" style={{ fontWeight: 500 }}>
              Shared
            </span>
          )}
        </div>
      </button>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          {renaming ? (
            <div className="min-w-0 flex-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setDraft(list.name); setRenaming(false); }
                }}
                className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-sm text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                style={{ fontWeight: 600 }}
              />
              <p className="mt-1 text-[10px] text-slate-400">Press Enter to save · Esc to cancel</p>
            </div>
          ) : (
            <button onClick={onOpen} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-slate-900" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {list.name}
                </div>
                {list.favorite && <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-500" />}
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500" style={{ lineHeight: 1.5 }}>
                {list.description}
              </p>
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setMenu((v) => !v)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="More"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-6 z-50 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg"
                  >
                    <MenuItem icon={Pencil} label="Rename" onClick={() => { setDraft(list.name); setRenaming(true); setMenu(false); }} />
                    <MenuItem icon={Star} label={list.favorite ? "Unfavorite" : "Favorite"} onClick={() => { onToggleFav(); setMenu(false); }} />
                    <MenuItem icon={Copy} label="Duplicate" onClick={() => { onDuplicate(); setMenu(false); }} />
                    <MenuItem icon={Share2} label="Share" onClick={() => setMenu(false)} />
                    <MenuItem icon={Download} label="Export CSV" onClick={() => setMenu(false)} />
                    <div className="my-1 h-px bg-slate-100" />
                    <MenuItem icon={Trash2} label="Delete" danger onClick={() => { onDelete(); setMenu(false); }} />
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{list.count}</span>
            <span>creators</span>
          </div>
          <div className="tabular-nums">Updated {list.updated}</div>
        </div>

        {list.reach && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 text-[11px]">
            <div>
              <div className="text-slate-500">Est. reach</div>
              <div className="tabular-nums text-slate-900" style={{ fontWeight: 600 }}>{list.reach}</div>
            </div>
          </div>
        )}

        {list.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {list.tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">#{t}</span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <FolderPlus className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="mt-4 text-slate-900" style={{ fontSize: 15, fontWeight: 600 }}>No lists yet</div>
      <p className="mt-1 max-w-sm text-sm text-slate-500">Create your first list to start organizing creators discovered through search.</p>
      <button onClick={onCreate} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
        <Plus className="h-3 w-3" /> Create list
      </button>
    </div>
  );
}

/* ─────────────────────── list detail ─────────────────────── */

type CreatorMeta = { note: string; tags: string[] };

function ListDetail({
  list,
  allLists,
  onBack,
  onRename,
}: {
  list: List;
  allLists: List[];
  onBack: () => void;
  onRename: (name: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, CreatorMeta>>({});
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const toast = useToast();
  const confirm = useConfirm();

  const commitRename = () => {
    setRenaming(false);
    if (draft.trim() && draft.trim() !== list.name) onRename(draft.trim());
    else setDraft(list.name);
  };

  const setNote = (id: string, note: string) =>
    setMeta((m) => ({ ...m, [id]: { note, tags: m[id]?.tags ?? [] } }));
  const addTag = (id: string, tag: string) => {
    const t = tag.trim().replace(/^#/, "");
    if (!t) return;
    setMeta((m) => {
      const cur = m[id] ?? { note: "", tags: [] };
      if (cur.tags.includes(t)) return m;
      return { ...m, [id]: { ...cur, tags: [...cur.tags, t] } };
    });
  };
  const removeTag = (id: string, tag: string) =>
    setMeta((m) => ({ ...m, [id]: { note: m[id]?.note ?? "", tags: (m[id]?.tags ?? []).filter((x) => x !== tag) } }));

  const moveTargets = allLists.filter((l) => l.id !== list.id);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const bulkRemove = async () => {
    const ok = await confirm({
      title: `Remove ${selected.size} creators?`,
      body: "They stay in your workspace but are removed from this list.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (ok) {
      toast.success(`${selected.size} creator${selected.size > 1 ? "s" : ""} removed`);
      setSelected(new Set());
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-3 w-3" /> Back to lists
      </button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {renaming ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setDraft(list.name); setRenaming(false); }
                }}
                className="min-w-0 flex-1 rounded-md border border-indigo-300 bg-white px-2 py-0.5 text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}
              />
            ) : (
              <button
                onClick={() => { setDraft(list.name); setRenaming(true); }}
                className="group inline-flex items-center gap-2 text-left"
                title="Rename list"
              >
                <h1 className="truncate tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
                  {list.name}
                </h1>
                <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" strokeWidth={2} />
              </button>
            )}
            {list.favorite && <Star className="h-4 w-4 fill-amber-400 text-amber-500" />}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{list.description}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {list.tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">#{t}</span>
            ))}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <IconBtn icon={Share2} label="Share" onClick={() => toast.info("Share link copied")} />
          <IconBtn icon={Download} label="Export" onClick={() => toast.success("Export started", "CSV will download shortly")} />
          <IconBtn icon={Copy} label="Duplicate" onClick={() => toast.success("List duplicated")} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Creators" value={String(list.count)} icon={Users} />
        <Stat label="Total followers" value="1.32M" icon={TrendingUp} />
        <Stat label="Avg auth. signals" value={String(list.avgAuth)} icon={Sparkles} />
        <Stat label="Reach" value={list.reach} icon={TrendingUp} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search creators in this list…"
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
          />
        </div>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>Filters</button>
        <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>Sort</button>
        <div className="ml-auto text-xs text-slate-500">{list.count} creators</div>
      </div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs"
          >
            <span className="text-indigo-800">
              <span style={{ fontWeight: 600 }}>{selected.size}</span> selected
            </span>
            <div className="flex items-center gap-1.5">
              <BulkAction label="Assign campaign" onClick={() => toast.success(`Assigned ${selected.size} creators to campaign`)} />
              <BulkAction label="Export CSV" onClick={() => toast.info("Export started")} />
              <BulkAction label="Add tag" onClick={() => toast.info("Tag applied")} />
              <BulkAction label="Remove" danger onClick={bulkRemove} />
              <button onClick={() => setSelected(new Set())} className="rounded-md px-2 py-1 text-indigo-700 hover:bg-indigo-100">Clear</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      {list.creators.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-16 text-center">
          <Users className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
          <div className="mt-3 text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>No creators yet</div>
          <p className="mt-1 max-w-sm text-xs text-slate-500">Search for creators and add them to this list.</p>
          <button onClick={() => toast.info("Redirecting to Search")} className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
            Go to Search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.creators.map((c) => (
            <ListCreatorCard
              key={c.id}
              creator={c}
              meta={meta[c.id] ?? { note: "", tags: [] }}
              selected={selected.has(c.id)}
              moveTargets={moveTargets.map((l) => l.name)}
              onToggleSelect={() => toggle(c.id)}
              onNote={(v) => setNote(c.id, v)}
              onAddTag={(t) => addTag(c.id, t)}
              onRemoveTag={(t) => removeTag(c.id, t)}
              onMove={(name) => toast.success(`Moved ${c.name} to "${name}".`)}
              onRemove={() => toast.info(`${c.name} removed from this list.`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ListCreatorCard({
  creator: c,
  meta,
  selected,
  moveTargets,
  onToggleSelect,
  onNote,
  onAddTag,
  onRemoveTag,
  onMove,
  onRemove,
}: {
  creator: Creator;
  meta: CreatorMeta;
  selected: boolean;
  moveTargets: string[];
  onToggleSelect: () => void;
  onNote: (v: string) => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
  onMove: (name: string) => void;
  onRemove: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showTag, setShowTag] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`relative flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-all hover:shadow-md ${
        selected ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <img src={c.avatar} alt={c.name} className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
          <div className="truncate text-[11px] text-slate-500">@{c.handle}</div>
          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
            <MapPin className="h-2.5 w-2.5" strokeWidth={2} /> {c.country} · <span className="capitalize">{c.platform}</span>
          </div>
        </div>
        {c.campaign && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>
            {c.campaign}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <MiniMetric label="Followers" value={c.followers} />
        <MiniMetric label="Auth" value={String(c.auth)} />
        <MiniMetric label="ER" value={`${c.eng}%`} />
      </div>

      {/* Per-creator tags */}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {meta.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            #{t}
            <button onClick={() => onRemoveTag(t)} className="text-slate-400 hover:text-slate-700">×</button>
          </span>
        ))}
        {showTag ? (
          <input
            autoFocus
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={() => { if (tagInput.trim()) onAddTag(tagInput); setTagInput(""); setShowTag(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onAddTag(tagInput); setTagInput(""); setShowTag(false); }
              if (e.key === "Escape") { setTagInput(""); setShowTag(false); }
            }}
            placeholder="tag"
            className="w-16 rounded-full border border-indigo-300 px-2 py-0.5 text-[10px] focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setShowTag(true)}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-slate-400 hover:text-slate-700"
          >
            <Tag className="h-2.5 w-2.5" strokeWidth={2} /> Tag
          </button>
        )}
      </div>

      {/* Per-creator note */}
      {editingNote ? (
        <textarea
          autoFocus
          value={meta.note}
          onChange={(e) => onNote(e.target.value)}
          onBlur={() => setEditingNote(false)}
          rows={2}
          placeholder="Add a private note about this creator…"
          className="mt-2 w-full resize-none rounded-md border border-indigo-300 bg-white p-2 text-[11px] text-slate-700 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        />
      ) : meta.note ? (
        <button
          onClick={() => setEditingNote(true)}
          className="mt-2 rounded-md bg-slate-50 p-2 text-left text-[11px] text-slate-600"
          style={{ lineHeight: 1.5 }}
        >
          {meta.note}
        </button>
      ) : (
        <button
          onClick={() => setEditingNote(true)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"
        >
          <MessageSquare className="h-3 w-3" strokeWidth={2} /> Add note
        </button>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3">
        <div className="relative flex-1">
          <button
            onClick={() => setMoveOpen((v) => !v)}
            disabled={moveTargets.length === 0}
            className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
            style={{ fontWeight: 500 }}
          >
            <FolderInput className="h-3 w-3" strokeWidth={2} /> Move to list
          </button>
          <AnimatePresence>
            {moveOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoveOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute bottom-full left-0 z-50 mb-1 max-h-40 w-48 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-[11px] shadow-lg"
                >
                  {moveTargets.map((name) => (
                    <button
                      key={name}
                      onClick={() => { onMove(name); setMoveOpen(false); }}
                      className="block w-full truncate px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-50"
                    >
                      {name}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={onRemove}
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
          title="Remove from list"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </motion.div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="tabular-nums text-slate-900" style={{ fontSize: 12, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function IconBtn({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      style={{ fontWeight: 500 }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} /> {label}
    </button>
  );
}

function BulkAction({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md bg-white px-2.5 py-1 text-xs shadow-sm transition-colors ${danger ? "text-red-600 hover:bg-red-50" : "text-indigo-700 hover:bg-indigo-100"}`}
      style={{ fontWeight: 500 }}
    >
      {label}
    </button>
  );
}
