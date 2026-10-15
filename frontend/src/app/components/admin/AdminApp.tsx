import { AdminConsole } from "../dashboard/AdminConsole";
import { useAdminAuth } from "../../admin/AdminAuthContext";
import { LogoMark } from "../landing/Logo";
import { LogOut, Shield, LifeBuoy } from "lucide-react";

/**
 * Standalone admin app shell — served at `/admin`.
 * Separate from the user dashboard; requires an admin/support sign-in.
 */
export function AdminApp({ onSignOut, onExit }: { onSignOut: () => void; onExit: () => void }) {
  const { admin } = useAdminAuth();
  if (!admin) return null;

  const RoleIcon = admin.role === "support" ? LifeBuoy : Shield;
  const roleLabel = admin.role === "super_admin" ? "Super Admin" : admin.role === "admin" ? "Admin" : "Support";

  return (
    <div className="flex h-screen flex-col bg-slate-50/40">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-slate-950 px-5 text-white">
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/10">
            <LogoMark variant="dark" size={24} />
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.04em" }}>MUSHIN · OPS</span>
          </button>
          <span className="hidden text-[11px] text-white/40 sm:inline">mushin.io / admin</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/80">
            <RoleIcon className="h-3 w-3" strokeWidth={2} />
            {roleLabel}
          </span>
          <div className="hidden text-right sm:block">
            <div style={{ fontSize: 12, fontWeight: 500 }}>{admin.name}</div>
            <div className="text-[11px] text-white/50">{admin.email}</div>
          </div>
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/10"
            style={{ fontWeight: 500 }}
          >
            <LogOut className="h-3 w-3" strokeWidth={2} />
            Sign out
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <AdminConsole onExit={onExit} role={admin.role} />
      </div>
    </div>
  );
}
