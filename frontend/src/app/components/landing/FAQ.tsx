import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";

const faqs = [
  {
    q: "What does Mushin actually do?",
    a: "Mushin helps brands and agencies in Pakistan find creators on Instagram, TikTok, and YouTube, see how well each one fits a brief (the Creator Fit score), review suspicious-activity signals, and keep lists, campaigns and an outreach log in one workspace.",
  },
  {
    q: "How is the Creator Fit score calculated?",
    a: "The Creator Fit score combines audience trust, engagement health, posting consistency, niche alignment, and campaign suitability into one number from 0 to 100. Each score includes a reasoning panel so you can see exactly what contributed — we don't hide the logic behind the number.",
  },
  {
    q: "Which platforms are supported?",
    a: "Instagram, TikTok, and YouTube. Every figure shows the date it was observed and is marked when it is aging or stale; you can refresh a creator's data on demand.",
  },
  {
    q: "How does bot and fake-follower detection work?",
    a: "Mushin looks at public engagement and follower patterns and flags what looks unusual, with the evidence behind each signal. These are signals to investigate before you commit budget, not verdicts.",
  },
  {
    q: "Can multiple teammates collaborate in one workspace?",
    a: "Yes. Invite teammates as owner, admin or member; lists, campaigns and the activity feed are shared across the workspace.",
  },
  {
    q: "How is Mushin priced?",
    a: "Each plan includes monthly credits, and you can buy top-up credits that never expire. Credits pay for searches, finding new creators, data refreshes and contact reveals, and every action shows its price before you confirm.",
  },
  {
    q: "How does Mushin handle security and data?",
    a: "Mushin uses role-based access within each workspace, keeps workspaces separate from each other, and lets you export your workspace or delete it at any time. Creator profiles are built from public information and labeled by freshness and confidence; estimates are never presented as verified facts.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="border-b border-slate-200/60 bg-white py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-indigo-600">FAQ</p>
          <h2
            className="mt-3 tracking-tight text-slate-900"
            style={{
              fontSize: "clamp(1.875rem, 3.5vw, 2.75rem)",
              lineHeight: 1.1,
              fontWeight: 600,
              letterSpacing: "-0.025em",
            }}
          >
            Questions, answered.
          </h2>
        </div>

        <Accordion type="single" collapsible className="mt-10 divide-y divide-slate-200 border-t border-b border-slate-200">
          {faqs.map((item, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-0">
              <AccordionTrigger
                className="py-5 text-left text-slate-900 hover:no-underline"
                style={{ fontSize: "0.9375rem", fontWeight: 500, letterSpacing: "-0.005em" }}
              >
                {item.q}
              </AccordionTrigger>
              <AccordionContent
                className="pb-5 pr-8 text-slate-600"
                style={{ fontSize: "0.9375rem", lineHeight: 1.65 }}
              >
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-10 text-center text-sm text-slate-500">
          Still have questions?{" "}
          <a href="#/login" className="text-slate-900 underline-offset-4 hover:underline">
            Sign in and ask Support
          </a>{" "}
          from your dashboard.
        </div>
      </div>
    </section>
  );
}
