import { Inbox as InboxIcon } from "lucide-react";
import { EmptyState } from "./states";

/**
 * Inbox sync, automated sequences and reply tracking are deferred (canonical spec page 17): no mailbox is connected and
 * nothing is sent. Outreach is logged by hand on each campaign creator ("Outreach"), which this page points to.
 */
export function Inbox({ onGoToCampaigns }: { onGoToCampaigns?: () => void }) {
  return (
    <div className="space-y-5">
      <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.025em] text-slate-900">Inbox</h1>
      <EmptyState
        icon={<InboxIcon className="h-5 w-5" />}
        title="Planned: not available yet"
        body="MUSHIN doesn't connect to your mailbox or send messages. Use a template from a campaign creator's Outreach panel in your own email or DM, then log what happened there."
        action={onGoToCampaigns && <button onClick={onGoToCampaigns} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white" style={{ fontWeight: 600 }}>Go to campaigns</button>}
      />
    </div>
  );
}
