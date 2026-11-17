import { Check, X } from "lucide-react";
import { PASSWORD_RULES } from "../../auth/password-rules";

/** The five password rules, each ticked as it is met. Unmet rules turn red only once `showErrors` is set. */
export function PasswordChecklist({ password, showErrors = false }: { password: string; showErrors?: boolean }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-y-1 text-[12px]">
      {PASSWORD_RULES.map((r) => {
        const ok = r.ok(password);
        const tone = ok ? "text-emerald-700" : showErrors ? "text-rose-600" : "text-slate-600";
        return (
          <li key={r.id} className={`flex items-center gap-1.5 transition-colors ${tone}`}>
            {ok ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden /> : <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
            <span>{r.label}</span>
            <span className="sr-only">{ok ? "(met)" : "(not met yet)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
