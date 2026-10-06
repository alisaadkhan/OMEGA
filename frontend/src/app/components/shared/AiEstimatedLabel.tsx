import { Sparkles } from "lucide-react";
import { COPY } from "../../lib/copy";

/**
 * Inline label for AI-estimated audience metrics.
 * Spec §8.4: every audience figure (age/gender/location) must carry this label.
 */
export function AiEstimatedLabel({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 ${className}`}
      style={{ fontWeight: 500 }}
      title={COPY.aiEstimated}
    >
      <Sparkles className="h-2.5 w-2.5" strokeWidth={2} />
      AI-estimated
    </span>
  );
}
