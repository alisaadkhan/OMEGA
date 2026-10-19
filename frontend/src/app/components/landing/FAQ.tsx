import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";

const faqs = [
  {
    q: "What does Mushin actually do?",
    a: "Mushin is an AI-powered influencer intelligence platform. It helps brands and agencies discover creators across Instagram, TikTok, and YouTube, verify audience authenticity, score influence quality with the Creator IQ, and run outreach and campaign operations — all in a single workspace.",
  },
  {
    q: "How is the Creator Fit score calculated?",
    a: "The Creator Fit score combines audience trust, engagement health, posting consistency, niche alignment, and campaign suitability into one number from 0 to 100. Each score includes a reasoning panel so you can see exactly what contributed — we don't hide the logic behind the number.",
  },
  {
    q: "Which platforms are supported?",
    a: "Instagram, TikTok, and YouTube are supported today. Creator data is refreshed continuously, and historical growth history is retained for trend analysis and authenticity detection.",
  },
  {
    q: "How does bot and fake-follower detection work?",
    a: "Mushin analyzes follower composition, engagement patterns, growth anomalies, and signs of engagement pods. Suspicious activity is surfaced as authenticity scores and event-level flags — so you can investigate before signing a creator.",
  },
  {
    q: "Can multiple teammates collaborate in one workspace?",
    a: "Yes. Workspaces support multi-team collaboration with roles, permissions, shared creator lists, and shared campaign pipelines. Built for agencies running multiple brand accounts and enterprise teams running global programs.",
  },
  {
    q: "How is Mushin priced?",
    a: "Pricing scales with seats and credit consumption. Credits are used for searches, data refreshes, and contact reveals. You can set hard caps, daily soft caps, and per-workflow caps to keep spend predictable. Enterprise plans include dedicated infrastructure and custom data residency.",
  },
  {
    q: "How does Mushin handle security and data?",
    a: "Mushin supports SSO, audit logs, and role-based access controls, and lets you export or request erasure of data at any time. Creator profiles are built from public information and clearly labeled by freshness and confidence — we never present estimates as verified facts.",
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
