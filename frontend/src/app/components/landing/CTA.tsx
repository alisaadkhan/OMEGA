import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "../ui/button";

export function CTA({ onPrimary }: { onPrimary?: () => void } = {}) {
  return (
    <section className="relative overflow-hidden border-b border-slate-200/60 bg-white py-28">
      {/* Ambient animated gradient orbs on the page background itself */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-10 h-[420px] w-[420px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(99,102,241,0.16), transparent 70%)" }}
        animate={{ x: [0, 24, -12, 0], y: [0, -14, 18, 0], scale: [1, 1.08, 0.96, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-32 bottom-0 h-[420px] w-[420px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.14), transparent 70%)" }}
        animate={{ x: [0, -18, 22, 0], y: [0, 14, -10, 0], scale: [1, 0.95, 1.06, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(99,102,241,0.08), transparent 70%)" }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.55, 0.8, 0.55] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="tracking-tight text-slate-900"
          style={{
            fontSize: "clamp(2rem, 4vw, 3rem)",
            lineHeight: 1.1,
            fontWeight: 600,
            letterSpacing: "-0.025em",
          }}
        >
          Ready to operate on intelligence?
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-4 max-w-xl text-slate-600"
          style={{ fontSize: "1.0625rem", lineHeight: 1.6 }}
        >
          Discover, verify, and orchestrate creator campaigns on a single intelligence layer.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button onClick={onPrimary} className="group h-11 rounded-md bg-slate-900 px-5 text-white shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-lg">
            Start free trial
            <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Button>
          <Button
            variant="outline"
            className="h-11 rounded-md border-slate-300 bg-white px-5 text-slate-900 transition-all duration-200 hover:-translate-y-px hover:bg-slate-50 hover:shadow-sm"
          >
            Request a demo
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
