import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

/**
 * Volumes 13 / 14 · Toast system.
 * Max 3 simultaneous, bottom-right on desktop.
 * Levels: success · error · warning · info.
 */

export type ToastLevel = "success" | "error" | "warning" | "info";

export type ToastInput = {
  level?: ToastLevel;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration?: number; // ms, 0 = persistent
};

type Toast = ToastInput & { id: number };

type Ctx = {
  toast: (t: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<Ctx | null>(null);

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = seq++;
      const level = t.level ?? "info";
      const duration = t.duration ?? (level === "error" ? 6000 : level === "warning" ? 5000 : 3500);
      setToasts((prev) => [...prev.slice(-2), { ...t, id, level }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const ctx: Ctx = {
    toast: push,
    success: (title, description) => push({ level: "success", title, description }),
    error: (title, description) => push({ level: "error", title, description }),
    warning: (title, description) => push({ level: "warning", title, description }),
    info: (title, description) => push({ level: "info", title, description }),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const noopToast: Ctx = {
  toast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
};

export function useToast() {
  return useContext(ToastContext) ?? noopToast;
}

/* ─────────────────────── viewport ─────────────────────── */

const config: Record<ToastLevel, { icon: any; iconColor: string; ring: string }> = {
  success: { icon: CheckCircle2, iconColor: "text-emerald-600", ring: "ring-emerald-100" },
  error: { icon: XCircle, iconColor: "text-red-600", ring: "ring-red-100" },
  warning: { icon: AlertTriangle, iconColor: "text-amber-600", ring: "ring-amber-100" },
  info: { icon: Info, iconColor: "text-indigo-600", ring: "ring-indigo-100" },
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col-reverse items-end gap-2 sm:bottom-6 sm:right-6">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const c = config[t.level ?? "info"];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className={`pointer-events-auto flex w-80 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg ring-1 ${c.ring}`}
            >
              <c.icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${c.iconColor}`} strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <div className="text-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>
                  {t.title}
                </div>
                {t.description && (
                  <div className="mt-0.5 text-[12px] text-slate-600" style={{ lineHeight: 1.45 }}>
                    {t.description}
                  </div>
                )}
                {t.action && (
                  <button
                    onClick={() => {
                      t.action!.onClick();
                      onDismiss(t.id);
                    }}
                    className="mt-1.5 text-[11px] text-indigo-600 hover:text-indigo-700"
                    style={{ fontWeight: 600 }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────── confirm dialog ─────────────────────── */

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

const ConfirmContext = createContext<{ confirm: (opts: ConfirmOptions) => Promise<boolean> } | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }));

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        state.resolve(false);
        setState(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AnimatePresence>
        {state && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                state.resolve(false);
                setState(null);
              }}
              className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-1/2 top-1/2 z-[100] w-[92%] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
              role="alertdialog"
              aria-modal="true"
            >
              <div className="p-5">
                <div className="text-slate-900" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {state.title}
                </div>
                {state.body && (
                  <p className="mt-1.5 text-sm text-slate-600" style={{ lineHeight: 1.55 }}>
                    {state.body}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                <button
                  onClick={() => {
                    state.resolve(false);
                    setState(null);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  style={{ fontWeight: 500 }}
                >
                  {state.cancelLabel ?? "Cancel"}
                </button>
                <button
                  onClick={() => {
                    state.resolve(true);
                    setState(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs text-white ${
                    state.destructive ? "bg-red-600 hover:bg-red-500" : "bg-slate-900 hover:bg-slate-800"
                  }`}
                  style={{ fontWeight: 500 }}
                >
                  {state.confirmLabel ?? (state.destructive ? "Delete" : "Confirm")}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

const noopConfirm = async (_opts: ConfirmOptions) =>
  typeof window !== "undefined" ? window.confirm(_opts.title) : true;

export function useConfirm() {
  return useContext(ConfirmContext)?.confirm ?? noopConfirm;
}
