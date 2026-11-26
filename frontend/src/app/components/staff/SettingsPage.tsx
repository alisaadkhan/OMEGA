import type { ReactNode } from "react";
import { UserCircle } from "lucide-react";
import type { AdminUser } from "../../admin/AdminAuthContext";
import { Card, PageHeader } from "./kit";
import { TwoFactorCard } from "./TwoFactorCard";
import { StepUpBar } from "../admin/staff-ui";
import { NotificationEmailToggle } from "./NotificationBell";
import { AvatarUpload } from "./StaffAvatar";

const ROLE = { super_admin: "CEO", admin: "Admin", support: "Support" } as const;

/**
 * Settings (owner design, 22 Nov): who is signed in, and the security keys. Name, email and role are set when a Super
 * Admin creates the staff account and cannot be edited here. Two-factor sign-in is each person's own setting.
 */
export function SettingsPage({ admin, security }: { admin: AdminUser; security: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1140px] space-y-6">
      <PageHeader eyebrow="Account & Security" title="Settings" sub="Your staff profile, two-factor sign-in, and the security keys that unlock admin actions." />
      <Card label="Profile details">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-cyan-50 text-cyan-600"><UserCircle className="h-5 w-5" /></div>
            <div><h2 className="text-base font-bold text-slate-900">Profile details</h2><p className="mt-0.5 text-xs text-slate-500">Name, email and role are set by the CEO when your account is made. Your photo is yours to change.</p></div>
          </div>
          <span className="inline-flex items-center gap-2 self-start rounded-2xl bg-[#0A0F24] px-3.5 py-1.5 text-xs font-bold text-white sm:self-center"><span className="h-2 w-2 rounded-full bg-[#06B6D4]" />Role: {ROLE[admin.role]}</span>
        </div>
        <div className="mt-5"><AvatarUpload name={admin.name} /></div>
        <dl className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div><dt className="text-xs font-bold text-slate-700">Full name</dt><dd className="mt-1.5 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-4 py-2.5 text-sm font-medium text-slate-900">{admin.name}</dd></div>
          <div><dt className="text-xs font-bold text-slate-700">Work email</dt><dd className="mt-1.5 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-4 py-2.5 text-sm font-medium text-slate-900">{admin.email}</dd></div>
        </dl>
      </Card>
      <NotificationEmailToggle />
      <TwoFactorCard />
      {/* Admin actions ask for the key on their own when needed; this confirms it ahead of time (5 minutes). */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white"><StepUpBar onSetUp={() => document.getElementById("security-keys")?.scrollIntoView({ behavior: "smooth" })} /></div>
      <div id="security-keys">{security}</div>
    </div>
  );
}
