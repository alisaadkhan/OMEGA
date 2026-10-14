import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Coins, X } from "lucide-react";
import { useCredits, spendCredits } from "../../lib/credits";

interface CreditConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human-readable description of the action, e.g. "Find New Creators" */
  action: string;
  cost: number;
  /** Called only after the user confirms and credits are deducted */
  onConfirm: () => void;
  children?: React.ReactNode;
}

/**
 * Confirmation dialog that shows the credit cost before a destructive action.
 * Handles the insufficient-credits state inline.
 * Spec §11: every credit-spending action must show cost before confirming.
 */
export function CreditConfirm({
  open,
  onOpenChange,
  action,
  cost,
  onConfirm,
}: CreditConfirmProps) {
  const balance = useCredits();
  const [processing, setProcessing] = useState(false);
  const insufficient = balance < cost;

  const handleConfirm = async () => {
    if (insufficient) return;
    setProcessing(true);
    const ok = spendCredits(cost);
    setProcessing(false);
    if (ok) {
      onOpenChange(false);
      onConfirm();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          aria-describedby="credit-confirm-desc"
        >
          <Dialog.Close className="absolute right-4 top-4 rounded p-1 text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" strokeWidth={2} />
          </Dialog.Close>

          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50">
            <Coins className="h-5 w-5 text-indigo-600" strokeWidth={1.75} />
          </div>

          <Dialog.Title className="mt-4 text-slate-900" style={{ fontSize: 16, fontWeight: 600 }}>
            {action}
          </Dialog.Title>

          <p id="credit-confirm-desc" className="mt-1.5 text-sm text-slate-500" style={{ lineHeight: 1.55 }}>
            This action costs{" "}
            <span className="font-semibold text-slate-900">{cost} credit{cost !== 1 ? "s" : ""}</span>.
            {" "}Your current balance is{" "}
            <span className={insufficient ? "font-semibold text-rose-600" : "font-semibold text-slate-900"}>
              {balance.toLocaleString()} credit{balance !== 1 ? "s" : ""}
            </span>.
          </p>

          {insufficient && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" strokeWidth={2} />
              <p className="text-xs text-rose-700" style={{ lineHeight: 1.5 }}>
                You don't have enough credits for this action. Top up your balance or wait for your monthly reset.
              </p>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => onOpenChange(false)}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
              style={{ fontWeight: 500 }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={insufficient || processing}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ fontWeight: 500 }}
            >
              {processing ? "Processing…" : insufficient ? "Insufficient credits" : `Confirm · ${cost} cr`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
