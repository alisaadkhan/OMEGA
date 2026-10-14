import { HelpCircle } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { METRIC_HELP } from "../../lib/copy";

type MetricKey = keyof typeof METRIC_HELP;

interface MetricTipProps {
  metric: MetricKey;
  children?: React.ReactNode;
}

/**
 * Tooltip that shows the plain-language definition for a metric.
 * Spec §9: every score/metric must have a tooltip definition the user can read.
 */
export function MetricTip({ metric, children }: MetricTipProps) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="inline-flex cursor-help items-center gap-1">
            {children}
            <HelpCircle className="h-3 w-3 text-slate-500 hover:text-slate-600" strokeWidth={2} />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-50 max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
            style={{ lineHeight: 1.5 }}
            sideOffset={4}
          >
            {METRIC_HELP[metric]}
            <Tooltip.Arrow className="fill-slate-200" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
