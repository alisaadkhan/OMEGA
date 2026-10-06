import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  User,
  CreditCard,
  Bell,
  ShieldCheck,
  Monitor,
  Puzzle,
  Palette,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Sparkles,
  Lock,
  Search as SearchIcon,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useToast, useConfirm } from "../../lib/toast";
import { profiles } from "../../auth/profiles";

/** SETTINGS module — profile, security, sessions, notifications, billing prefs, integrations, AI, privacy, appearance, danger zone. */

type Tab =
  | "profile"
  | "billing"
  | "notifications"
  | "security"
  | "sessions"
  | "integrations"
  | "ai"
  | "privacy"
  | "appearance"
  | "danger";

const tabs: { id: Tab; label: string; icon: any; group: string }[] = [
  { id: "profile", label: "Profile", icon: User, group: "Account" },
  { id: "security", label: "Security", icon: ShieldCheck, group: "Account" },
  { id: "sessions", label: "Sessions", icon: Monitor, group: "Account" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "Account" },
  { id: "billing", label: "Billing", icon: CreditCard, group: "Billing" },
  { id: "integrations", label: "Integrations", icon: Puzzle, group: "Billing" },
  { id: "ai", label: "AI settings", icon: Sparkles, group: "Preferences" },
  { id: "privacy", label: "Data & privacy", icon: Lock, group: "Preferences" },
  { id: "appearance", label: "Appearance", icon: Palette, group: "Preferences" },
  { id: "danger", label: "Danger zone", icon: AlertTriangle, group: "Preferences" },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("profile");
  const groups = Array.from(new Set(tabs.map((t) => t.group)));

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Sub-nav */}
      <aside className="w-full flex-shrink-0 lg:w-56">
        <h1 className="tracking-tight text-slate-900" style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
          Settings
        </h1>
        <p className="mt-1 text-xs text-slate-500">Account, billing and preferences.</p>
        <nav className="mt-4 space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 px-2 text-[10px] uppercase tracking-wider text-slate-400" style={{ fontWeight: 600 }}>{g}</div>
              <div className="space-y-0.5">
                {tabs.filter((t) => t.group === g).map((t) => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        active ? "bg-slate-900 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
                      }`}
                      style={{ fontWeight: 500 }}
                    >
                      <t.icon className={`h-3.5 w-3.5 ${active ? "text-white" : t.id === "danger" ? "text-red-500" : "text-slate-500"}`} strokeWidth={1.75} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="max-w-2xl space-y-5"
          >
            {tab === "profile" && <ProfileTab />}
            {tab === "billing" && <BillingPrefsTab />}
            {tab === "notifications" && <NotificationsTab />}
            {tab === "security" && <SecurityTab />}
            {tab === "sessions" && <SessionsTab />}
            {tab === "integrations" && <IntegrationsTab />}
            {tab === "ai" && <AISettingsTab />}
            {tab === "privacy" && <PrivacyTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "danger" && <DangerTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────── shared ─────────────────────── */

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{children}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-slate-500" style={{ fontWeight: 600 }}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100"
    />
  );
}

function Toggle({ enabled: initial, onChange, label, hint }: { enabled: boolean; onChange?: (v: boolean) => void; label: string; hint?: string }) {
  const [on, setOn] = useState(initial);
  return (
    <label className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <div>
        <div className="text-sm text-slate-900" style={{ fontWeight: 500 }}>{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
      </div>
      <button
        onClick={() => {
          const next = !on;
          setOn(next);
          onChange?.(next);
        }}
        className={`relative flex-shrink-0 h-5 w-9 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-300"}`}
        aria-pressed={on}
      >
        <motion.span
          animate={{ x: on ? 18 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
        />
      </button>
    </label>
  );
}

function SaveBar({ onSave, onDiscard }: { onSave: () => void; onDiscard?: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
      {onDiscard && (
        <button onClick={onDiscard} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Discard
        </button>
      )}
      <button onClick={onSave} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800" style={{ fontWeight: 500 }}>
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Save changes
      </button>
    </div>
  );
}

/* ─────────────────────── tabs ─────────────────────── */

function ProfileTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "Ahmed Raza Khan");
  const [email] = useState(user?.email ?? "ahmed@mushin.pk");
  const [bio, setBio] = useState("Head of Growth · brand & creator partnerships in South Asia.");
  const [tz, setTz] = useState("Asia/Karachi");
  const [lang, setLang] = useState("English (Pakistan)");

  return (
    <>
      <Card>
        <SectionTitle sub="How you appear across your workspace.">Profile</SectionTitle>
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <img src={user?.avatar ?? profiles.ahmed.avatar} className="h-14 w-14 rounded-full object-cover ring-2 ring-white shadow-sm" alt={name} />
            <div>
              <button onClick={() => toast.info("Upload a new avatar (dev stub)")} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                Change avatar
              </button>
              <div className="mt-1 text-[11px] text-slate-500">PNG or JPG · 512×512 min.</div>
            </div>
          </div>
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" hint="Email changes are handled by support to prevent hijacking.">
            <Input value={email} disabled className="!bg-slate-50" />
          </Field>
          <Field label="Bio">
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timezone"><Input value={tz} onChange={(e) => setTz(e.target.value)} /></Field>
            <Field label="Language"><Input value={lang} onChange={(e) => setLang(e.target.value)} /></Field>
          </div>
          <SaveBar onSave={() => toast.success("Profile saved")} onDiscard={() => toast.info("Discarded changes")} />
        </div>
      </Card>
    </>
  );
}

function BillingPrefsTab() {
  const toast = useToast();
  return (
    <Card>
      <SectionTitle sub="How invoices, receipts, and tax details are handled.">Billing preferences</SectionTitle>
      <div className="mt-4 space-y-4">
        <Field label="Billing email"><Input defaultValue="finance@mushin.pk" /></Field>
        <Field label="Company legal name"><Input defaultValue="MUSHIN Technologies (Pvt.) Ltd." /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NTN"><Input defaultValue="1234567-8" /></Field>
          <Field label="STRN"><Input defaultValue="1122334455" /></Field>
        </div>
        <Field label="Billing address"><Input defaultValue="Plot 42, Clifton Block 5, Karachi" /></Field>
        <SaveBar onSave={() => toast.success("Billing details saved")} />
      </div>
    </Card>
  );
}

function NotificationsTab() {
  return (
    <Card>
      <SectionTitle sub="Choose how you want to be reached.">Notifications</SectionTitle>
      <div className="mt-3">
        <Toggle enabled label="Email · search completion" hint="Sent when a search finishes running." />
        <Toggle enabled label="Email · campaign updates" hint="Status changes, replies, and milestones." />
        <Toggle enabled label="Email · security alerts" hint="Recommended — new devices, MFA changes." />
        <Toggle enabled={false} label="Email · billing alerts" hint="Invoices, failed charges, plan changes." />
        <Toggle enabled={false} label="Email · weekly digest" hint="A summary of workspace activity every Monday." />
        <Toggle enabled={false} label="Email · marketing" hint="Product updates, best practices, event invites." />
        <Toggle enabled label="In-app · everything" hint="Show all notifications in the bell menu." />
      </div>
    </Card>
  );
}

function SecurityTab() {
  const toast = useToast();
  const [mfa, setMfa] = useState(true);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  return (
    <>
      <Card>
        <SectionTitle sub="Update the password on your account.">Password</SectionTitle>
        <div className="mt-3 space-y-3">
          <Field label="Current password"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="New password"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirm new password"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <SaveBar onSave={() => { setPw({ current: "", next: "", confirm: "" }); toast.success("Password updated"); }} />
        </div>
      </Card>

      <Card>
        <SectionTitle sub="Add a second step when signing in.">Multi-factor authentication</SectionTitle>
        <div className="mt-3">
          <Toggle enabled={mfa} onChange={setMfa} label="Authenticator app" hint="Recommended — Google Authenticator, 1Password, Authy." />
          <Toggle enabled={false} label="SMS" hint="Send a code by SMS. Less secure than an authenticator app." />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => toast.info("Recovery codes downloaded")} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
            Download recovery codes
          </button>
        </div>
      </Card>
    </>
  );
}

function SessionsTab() {
  const toast = useToast();
  const rows = [
    { device: "MacBook Pro · Safari", city: "Karachi", ip: "39.34.•••.18", when: "Just now", current: true },
    { device: "iPhone 15 Pro · Safari", city: "Karachi", ip: "39.34.•••.18", when: "3h", current: false },
    { device: "Windows · Chrome", city: "Lahore", ip: "103.240.•••.9", when: "Yesterday", current: false },
  ];
  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle sub="Every device signed in to your Mushin account.">Active sessions</SectionTitle>
        <button onClick={() => toast.success("All other sessions revoked")} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
          Sign out all others
        </button>
      </div>
      <div className="mt-4 divide-y divide-slate-100">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between py-2.5">
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-900" style={{ fontWeight: 500 }}>
                {r.device}
                {r.current && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>This device</span>}
              </div>
              <div className="text-[11px] text-slate-500">{r.city} · {r.ip} · {r.when}</div>
            </div>
            {!r.current && (
              <button onClick={() => toast.success("Session revoked")} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50" style={{ fontWeight: 500 }}>
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function IntegrationsTab() {
  const toast = useToast();
  const items = [
    { name: "HubSpot", desc: "Sync creators, campaigns and deals to your CRM.", connected: true },
    { name: "Slack", desc: "Get campaign and search alerts in Slack channels.", connected: true },
    { name: "Discord", desc: "Push activity events to your workspace Discord.", connected: false },
    { name: "Zapier", desc: "Wire Mushin events into 6,000+ apps.", connected: false },
    { name: "Webhooks", desc: "Send raw event payloads to your endpoint.", connected: false },
  ];
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <Card key={i.name}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-slate-900" style={{ fontSize: 14, fontWeight: 600 }}>{i.name}</div>
                {i.connected && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700" style={{ fontWeight: 600 }}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
                </span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{i.desc}</p>
            </div>
            <button
              onClick={() => toast.success(`${i.name} ${i.connected ? "disconnected" : "connected"}`)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${i.connected ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "bg-slate-900 text-white hover:bg-slate-800"}`}
              style={{ fontWeight: 500 }}
            >
              {i.connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AISettingsTab() {
  const toast = useToast();
  const [mode, setMode] = useState<"fast" | "live">("fast");
  const [threshold, setThreshold] = useState("30");
  return (
    <>
      <Card>
        <SectionTitle sub="Control how MUSHIN interprets searches and spends credits. These settings never expose which engines run behind the scenes.">
          AI &amp; search
        </SectionTitle>
        <div className="mt-4 space-y-4">
          <Field label="Default search mode" hint="Search Existing Creators is free — it searches your existing database. Find New Creators goes to the web and costs credits.">
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([
                { id: "fast", label: "Search Existing Creators", icon: SearchIcon },
                { id: "live", label: "Find New Creators", icon: Sparkles },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs transition-colors ${
                    mode === m.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  <m.icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {m.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Consider data stale after (days)" hint="Results older than this are flagged so you can refresh before deciding.">
            <select value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100">
              {["14", "30", "60", "90"].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </Field>
          <SaveBar onSave={() => toast.success("AI settings saved")} />
        </div>
      </Card>

      <Card>
        <SectionTitle sub="Guardrails for how credits are spent on your behalf.">Automation &amp; spend</SectionTitle>
        <div className="mt-3">
          <Toggle enabled label="Auto-interpret my queries" hint="Turn plain-language searches into editable filters before running." />
          <Toggle enabled label="Confirm before live discovery" hint="Always show the estimated credit cost and ask before spending." />
          <Toggle enabled={false} label="Auto-refresh stale profiles" hint="Silently update aging data when I open a profile. Costs credits." />
          <Toggle enabled label="Show confidence on estimates" hint="Label estimated audience figures with a confidence level." />
        </div>
      </Card>
    </>
  );
}

function PrivacyTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (handle.trim().length < 2) return;
    const ok = await confirm({
      title: `Request erasure for ${handle.trim()}?`,
      body: "We'll remove this creator's data from your workspace and log a deletion request against our records. This does not delete their public social profiles.",
      confirmLabel: "Submit request",
    });
    if (ok) {
      setHandle("");
      setReason("");
      toast.success("Erasure request submitted", "We'll confirm by email once processed.");
    }
  };

  return (
    <>
      <Card>
        <SectionTitle sub="How MUSHIN handles the creator data you discover.">Creator data &amp; privacy</SectionTitle>
        <p className="mt-3 text-sm text-slate-600" style={{ lineHeight: 1.6 }}>
          Creator profiles are built from public information and clearly labeled with freshness and
          confidence. Contact details are only ever revealed when you choose to spend credits, and one
          successful delivery does not mean a creator has confirmed the address.
        </p>
      </Card>

      <Card>
        <SectionTitle sub="Distinct from your own account data — this removes a creator's information at their (or your) request.">
          Request creator data erasure
        </SectionTitle>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="Creator handle or profile URL">
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle or https://instagram.com/…" />
          </Field>
          <Field label="Reason (optional)" hint="Helps us process the request and confirm authority to make it.">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-4 focus:ring-indigo-100" placeholder="e.g. Creator requested removal; no longer active." />
          </Field>
          <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600" style={{ lineHeight: 1.5 }}>
            <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" strokeWidth={2} />
            Erasure removes the creator from your lists and cached intelligence and records a deletion
            request. It can't remove their public social-media presence. Processing may take a few days.
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={handle.trim().length < 2} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-1.5 text-xs text-white transition-colors hover:bg-slate-800 disabled:opacity-50" style={{ fontWeight: 500 }}>
              <Trash2 className="h-3 w-3" strokeWidth={2} /> Submit erasure request
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}

function AppearanceTab() {
  const [theme, setTheme] = useState("light");
  const [density, setDensity] = useState("comfortable");
  return (
    <Card>
      <SectionTitle sub="Adjust how Mushin looks and feels.">Appearance</SectionTitle>
      <div className="mt-4 space-y-4">
        <Field label="Theme">
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-md border px-3 py-2 text-xs capitalize transition-colors ${theme === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                style={{ fontWeight: 500 }}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Density">
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`rounded-md border px-3 py-2 text-xs capitalize transition-colors ${density === d ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                style={{ fontWeight: 500 }}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Toggle enabled label="Interface animations" hint="Turn off to reduce motion." />
        <Toggle enabled label="Show sidebar tooltips" hint="Reveal item labels on hover when collapsed." />
      </div>
    </Card>
  );
}

function DangerTab() {
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <Card className="border-red-200 bg-red-50/40">
      <SectionTitle sub="Permanent, irreversible actions live here. Handle with care.">Danger zone</SectionTitle>
      <div className="mt-4 space-y-3">
        <RedRow
          title="Export all my data"
          desc="Get a full ZIP with your lists, campaigns, activity and settings. Delivered by email."
          cta="Export data"
          onClick={() => toast.success("Export queued", "You'll receive an email when it's ready.")}
        />
        <RedRow
          title="Remove personal data"
          desc="Strip PII (name, avatar) from historical events while keeping analytics intact."
          cta="Remove personal data"
          onClick={async () => {
            const ok = await confirm({ title: "Remove personal data?", body: "This can't be undone.", destructive: true });
            if (ok) toast.success("Personal data removed");
          }}
        />
        <RedRow
          title="Delete account"
          desc="Permanently removes your Mushin account and all associated lists, campaigns, and invoices."
          cta="Delete account"
          onClick={async () => {
            const ok = await confirm({ title: "Delete your account?", body: "This is permanent and irreversible. In production this requires re-authentication.", destructive: true, confirmLabel: "Delete account" });
            if (ok) toast.success("Account scheduled for deletion");
          }}
        />
      </div>
    </Card>
  );
}

function RedRow({ title, desc, cta, onClick }: { title: string; desc: string; cta: string; onClick: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-white p-3">
      <div>
        <div className="text-sm text-red-800" style={{ fontWeight: 600 }}>{title}</div>
        <p className="mt-0.5 text-xs text-red-700" style={{ lineHeight: 1.5 }}>{desc}</p>
      </div>
      <button onClick={onClick} className="flex-shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50" style={{ fontWeight: 500 }}>
        {cta}
      </button>
    </div>
  );
}
