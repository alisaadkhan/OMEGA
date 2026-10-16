import { LEGAL_VERSION } from "@mushin/contracts";

/**
 * Terms, Privacy Policy, Refund policy and Creator data notice (audit UX-01). These are DRAFTS that describe what MUSHIN
 * actually does, written from the code; they are not legal advice and must be reviewed by counsel before MUSHIN accepts
 * real customers (owner decision D-13). Every statement here must stay true of the running product.
 */
export type LegalDoc = "terms" | "privacy" | "refunds" | "creator-data";

const TITLES: Record<LegalDoc, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  refunds: "Credits and refunds",
  "creator-data": "Creator data notice",
};

const S = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-slate-900" style={{ fontSize: 17, fontWeight: 600 }}>{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
  </section>
);

const BODIES: Record<LegalDoc, React.ReactNode> = {
  terms: (
    <>
      <S title="What MUSHIN is">
        <p>MUSHIN helps brands and agencies in Pakistan find creators, keep shortlists and run campaigns. You search MUSHIN's catalogue of public creator profiles, ask MUSHIN to find new creators on the web, and organise your work in lists and campaigns.</p>
      </S>
      <S title="Your account and workspace">
        <p>You need an account with a confirmed email address. Your work lives in a workspace; its owner can invite others as admins or members. Each person is responsible for what they do in the workspace, and the owner controls billing, roles and deletion.</p>
      </S>
      <S title="Credits and plans">
        <p>Searches, Live Discovery runs, contact reveals and data refreshes use credits. You always see the price before you confirm. Plans, their monthly credits and what each includes are listed on the pricing page; the rules for credits are in <a className="text-indigo-700 underline" href="#/refunds">Credits and refunds</a>.</p>
      </S>
      <S title="Acceptable use">
        <p>Use creator contact details only to propose genuine collaborations. Do not send bulk or unsolicited messages, resell MUSHIN data, or try to reach other workspaces' data. MUSHIN may suspend accounts that do.</p>
      </S>
      <S title="What MUSHIN does not promise">
        <p>Creator data comes from public sources and can be incomplete or out of date; MUSHIN labels what it knows, how old it is and what is unverified, and never invents metrics. Search quality is still being independently evaluated.</p>
      </S>
    </>
  ),
  privacy: (
    <>
      <S title="What we keep about you">
        <p>Your name, email address and the workspaces you belong to; what you create in a workspace (lists, campaigns, notes, outreach records, support requests); your credit and payment history; and security logs (sign-ins, requests) for protection against abuse.</p>
      </S>
      <S title="Who processes it for us">
        <p>Supabase (database and sign-in), Paddle (payments, when enabled), and the providers MUSHIN uses to collect public creator data: Apify, Serper (web search), the YouTube Data API, and Groq and Ollama Cloud (AI reading of public profiles). An email provider is used only once outreach email is switched on.</p>
      </S>
      <S title="Your rights">
        <p>In Settings › Privacy & data you can download your workspace's data, delete a workspace you own, or delete your account. Billing records are kept for accounting after a deletion; the retention period has not been set yet and will be stated here.</p>
      </S>
      <S title="Security">
        <p>Each workspace's data is separated in the database itself. Creator contact details are stored encrypted and shown only to workspaces that reveal them.</p>
      </S>
    </>
  ),
  refunds: (
    <>
      <S title="Monthly and top-up credits">
        <p>A plan's monthly credits end when the billing period renews and do not roll over. Credits you buy as a top-up never expire and are used after your monthly credits.</p>
      </S>
      <S title="When an action costs nothing">
        <p>A failed action is not charged and its held credits come back. A Live Discovery run that delivers no creator costs nothing; the exact rule is shown with every quote.</p>
      </S>
      <S title="Refunds">
        <p>MUSHIN's refund policy for payments has not been decided yet. Paid plans are not open until it is published here. If a payment is refunded or charged back, the unspent credits it bought are removed.</p>
      </S>
    </>
  ),
  "creator-data": (
    <>
      <S title="If you are a creator">
        <p>MUSHIN lists creators from public profiles on Instagram, TikTok and YouTube: name, handle, public counts, bio and public contact details. It does not show creators who may be under 18.</p>
      </S>
      <S title="Data from YouTube">
        <p>Data MUSHIN receives through the YouTube API is refreshed or deleted within 30 days.</p>
      </S>
      <S title="Removal">
        <p>You can ask MUSHIN to remove your profile with the <a className="text-indigo-700 underline" href="#/remove-my-data">removal form</a>. Your profile is hidden at once while the request is reviewed.</p>
      </S>
    </>
  ),
};

export function LegalPage({ doc, onBack }: { doc: LegalDoc; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <main className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <button onClick={onBack} className="text-xs text-slate-600 underline-offset-2 hover:underline">← Back</button>
        <div>
          <h1 className="text-slate-900" style={{ fontSize: 26, fontWeight: 700 }}>{TITLES[doc]}</h1>
          <p className="mt-1 text-xs text-slate-600">Version {LEGAL_VERSION}</p>
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="note">
            Draft, not yet reviewed by a lawyer. It describes how MUSHIN works today. MUSHIN is not open to paying customers until these documents are final.
          </p>
        </div>
        {BODIES[doc]}
        <nav aria-label="Legal documents" className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs">
          {/* At least 24 px tall touch targets (WCAG 2.2 target size). */}
          {(Object.keys(TITLES) as LegalDoc[]).map((d) => <a key={d} href={`#/${d}`} className="inline-flex min-h-[28px] items-center text-indigo-700 underline-offset-2 hover:underline">{TITLES[d]}</a>)}
        </nav>
      </main>
    </div>
  );
}
