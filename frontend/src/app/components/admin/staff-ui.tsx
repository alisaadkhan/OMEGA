import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { keyErrorMessage, securityState, stepUp, webauthnSupported } from "../../admin/webauthn";
import { ApiError } from "../../api/http";
import { useToast } from "../../lib/toast";

/** "Needs your security key" errors from the staff API (reason hardware_key_required). */
export const needsKey = (err: unknown) => err instanceof ApiError && err.status === 403 && /security key/i.test(err.message);
export const errText = (err: unknown) => (err instanceof Error ? err.message : undefined);

type StepUpCtx = { confirmed: boolean; required: boolean; hasKey: boolean; busy: boolean; confirm: () => Promise<boolean> };
const Ctx = createContext<StepUpCtx>({ confirmed: false, required: false, hasKey: false, busy: false, confirm: async () => false });
export const useStepUp = () => useContext(Ctx);

/**
 * The session's hardware-key state for the whole console. Admin and Super Admin actions need a key confirmed in this
 * session (it lasts 5 minutes, checked by the server on every admin action); Support never needs one.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Re-read every 30 s so the bar shows when the 5-minute confirmation has run out.
  const q = useQuery({ queryKey: ["admin", "security"], queryFn: securityState, staleTime: 30_000, refetchInterval: 30_000 });
  const confirm = useCallback(async () => {
    if (!webauthnSupported()) {
      toast.error("This browser cannot use security keys");
      return false;
    }
    setBusy(true);
    try {
      await stepUp();
      await qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success("Security key confirmed for 5 minutes");
      return true;
    } catch (err) {
      toast.error("Security key not confirmed", keyErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [qc, toast]);
  const value = { confirmed: q.data?.factors.includes("hwk") ?? false, required: q.data?.hardwareKeyRequired ?? false, hasKey: (q.data?.keys.length ?? 0) > 0, busy, confirm };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Header strip: whether privileged actions are available right now, and the one action that makes them so. */
export function StepUpBar({ onSetUp }: { onSetUp: () => void }) {
  const s = useStepUp();
  if (!s.required) return null;
  if (s.confirmed) {
    return (
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-6 py-2 text-xs text-emerald-800" role="status">
        <ShieldCheck className="h-3.5 w-3.5" /> Security key confirmed. Admin actions are available for 5 minutes after each confirmation.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-6 py-2 text-xs text-amber-900" role="status">
      <KeyRound className="h-3.5 w-3.5" />
      {s.hasKey ? "Admin actions need your security key." : "Admin actions need a security key. Register one first."}
      {s.hasKey ? (
        <button onClick={() => void s.confirm()} disabled={s.busy} className="ml-auto rounded-md bg-slate-900 px-2.5 py-1 text-white disabled:opacity-50" style={{ fontWeight: 600 }}>{s.busy ? "Waiting for key…" : "Confirm with security key"}</button>
      ) : (
        <button onClick={onSetUp} className="ml-auto rounded-md bg-slate-900 px-2.5 py-1 text-white" style={{ fontWeight: 600 }}>Register a security key</button>
      )}
    </div>
  );
}

/**
 * A small form for an action that needs a written reason (at least 12 characters, as the API requires). The action is
 * only offered as a button until opened, so nothing happens on a single click.
 */
export function ReasonAction({ label, confirmLabel, onSubmit, destructive, disabled, disabledReason }: { label: string; confirmLabel: string; onSubmit: (reason: string) => Promise<unknown>; destructive?: boolean; disabled?: boolean; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const step = useStepUp();
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={disabled} title={disabled ? disabledReason : undefined} className={`rounded-md border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${destructive ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`} style={{ fontWeight: 500 }}>
        {label}
      </button>
    );
  }
  const ok = reason.trim().length >= 12;
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        setBusy(true);
        try {
          await onSubmit(reason.trim());
          setOpen(false);
          setReason("");
        } catch (err) {
          if (needsKey(err) && (await step.confirm())) {
            try {
              await onSubmit(reason.trim());
              setOpen(false);
              setReason("");
            } catch (again) {
              toast.error(`Couldn't ${label.toLowerCase()}`, errText(again));
            }
          } else if (!needsKey(err)) toast.error(`Couldn't ${label.toLowerCase()}`, errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} aria-label={`Reason to ${label.toLowerCase()}`} placeholder="Reason (at least 12 characters)" className="w-64 rounded-md border border-slate-200 px-2 py-1 text-[11px]" />
      <button type="submit" disabled={!ok || busy} className={`rounded-md px-2 py-1 text-[11px] text-white disabled:opacity-50 ${destructive ? "bg-red-600" : "bg-slate-900"}`} style={{ fontWeight: 600 }}>{busy ? "Working…" : confirmLabel}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-slate-500 hover:underline">Cancel</button>
    </form>
  );
}
