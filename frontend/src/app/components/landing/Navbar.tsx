import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button } from "../ui/button";
import { Logo, LogoMark } from "./Logo";
import { useAuth } from "../../auth/AuthContext";

type Props = { onPrimary: () => void; onLogin: () => void };

const leftLinks = [
  { label: "Platform", href: "#platform" },
  { label: "Pricing", href: "#pricing" },
];
const rightLinks = [
  { label: "FAQ", href: "#faq" },
  { label: "Docs", href: "#" },
];

export function Navbar({ onPrimary, onLogin }: Props) {
  const { user, logout } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleAnchor = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!href.startsWith("#") || href === "#") return;
    e.preventDefault();
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <motion.header
      initial={false}
      animate={{ paddingTop: scrolled ? 10 : 16, paddingBottom: scrolled ? 10 : 16 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 w-full"
    >
      <motion.div
        initial={false}
        animate={{
          backgroundColor: scrolled ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0)",
          borderColor: scrolled ? "rgba(226,232,240,0.7)" : "rgba(226,232,240,0)",
          boxShadow: scrolled ? "0 8px 30px -16px rgba(15,23,42,0.18)" : "0 0 0 rgba(0,0,0,0)",
          backdropFilter: scrolled ? "blur(12px)" : "blur(0px)",
          maxWidth: scrolled ? "880px" : "1200px",
        }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto flex items-center justify-between rounded-full border px-3 sm:px-4"
        style={{ WebkitBackdropFilter: scrolled ? "blur(12px)" : undefined }}
      >
        <div className="flex flex-1 items-center gap-1 sm:gap-2">
          <nav className="hidden items-center gap-1 md:flex">
            {leftLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={(e) => handleAnchor(e, l.href)}
                className="rounded-full px-3 py-2 text-sm text-slate-600 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>

        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="flex flex-shrink-0 items-center px-2 py-2 transition-opacity duration-200 hover:opacity-80"
          aria-label="Mushin home"
        >
          <motion.div
            initial={false}
            animate={{ scale: scrolled ? 0.94 : 1 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="origin-center"
          >
            <span className="hidden sm:inline-block">
              <Logo />
            </span>
            <span className="inline-block sm:hidden">
              <LogoMark />
            </span>
          </motion.div>
        </a>

        <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
          <nav className="hidden items-center gap-1 md:flex">
            {rightLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={(e) => handleAnchor(e, l.href)}
                className="rounded-full px-3 py-2 text-sm text-slate-600 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900"
              >
                {l.label}
              </a>
            ))}
          </nav>

          {user ? (
            <>
              <button
                onClick={() => void logout()}
                className="ml-1 hidden rounded-full px-3 py-2 text-sm text-slate-600 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900 lg:inline-block"
              >
                Sign out
              </button>
              <Button
                onClick={onPrimary}
                className="h-9 gap-2 rounded-full bg-slate-900 px-2 pr-4 text-sm text-white transition-all duration-200 hover:-translate-y-px hover:bg-slate-800 hover:shadow-md"
              >
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="h-7 w-7 flex-shrink-0 rounded-full object-cover ring-2 ring-white/20"
                />
                Dashboard
              </Button>
            </>
          ) : (
            <>
              <button
                onClick={onLogin}
                className="ml-1 hidden rounded-full px-3 py-2 text-sm text-slate-600 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900 lg:inline-block"
              >
                Log in
              </button>
              <Button
                onClick={onPrimary}
                className="h-9 rounded-full bg-slate-900 px-4 text-sm text-white transition-all duration-200 hover:-translate-y-px hover:bg-slate-800 hover:shadow-md"
              >
                Get started
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </motion.header>
  );
}
