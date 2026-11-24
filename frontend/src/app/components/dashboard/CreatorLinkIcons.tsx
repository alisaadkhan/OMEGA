import type { ComponentType, MouseEvent, SVGProps } from "react";
import { Asterisk, AtSign, Facebook, Ghost, Globe, Instagram, Link2, Linkedin, MessagesSquare, Music2, Twitch, Youtube } from "lucide-react";
import { LINK_KIND_NAME, type BioLink, type LinkKind } from "@mushin/contracts";

type Icon = ComponentType<Omit<SVGProps<SVGSVGElement>, "ref"> & { strokeWidth?: number | string }>;

/** Brand glyphs lucide does not ship: TikTok, X and WhatsApp, drawn in currentColor. */
const glyph = (d: string): Icon => (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d={d} />
  </svg>
);
const TikTok = glyph("M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.6 2.6 0 0 1-2.6-2.6c0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z");
const XLogo = glyph("M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z");
const WhatsApp = glyph("M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.7-1.1-4.5-3.9-4.6-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.4.2.5.3.1.2.1.7-.1 1.3z");

const ICON: Record<LinkKind, Icon> = {
  instagram: Instagram, youtube: Youtube, tiktok: TikTok,
  linktree: Asterisk, beacons: Link2, taplink: Link2, hoobe: Link2, biosite: Link2, campsite: Link2,
  whatsapp: WhatsApp, facebook: Facebook, x: XLogo, snapchat: Ghost, linkedin: Linkedin, threads: AtSign,
  twitch: Twitch, discord: MessagesSquare, spotify: Music2, website: Globe,
};

/**
 * A creator's links as one row of brand icons (owner, 24 Nov): never a raw URL. Each icon opens in a new tab, says
 * what it is on hover ("Instagram · @handle", "Linktree", a domain) and never triggers the card it sits on.
 */
export function CreatorLinkIcons({ links, size = "md", className = "" }: { links: readonly BioLink[]; size?: "sm" | "md"; className?: string }) {
  if (links.length === 0) return null;
  const box = size === "sm" ? "h-7 w-7 rounded-xl" : "h-8 w-8 rounded-xl";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <ul role="list" aria-label="Creator links" className={`flex flex-wrap items-center gap-1.5 ${className}`} onClick={stop}>
      {links.map((l) => {
        const Glyph = ICON[l.kind] ?? Globe;
        return (
          <li key={l.url} className="group relative">
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              aria-label={l.label}
              data-link-kind={l.kind}
              className={`flex ${box} items-center justify-center border border-slate-200/80 bg-white text-[#0A0F24] shadow-sm transition-colors hover:border-[#06B6D4] hover:bg-[#06B6D4]/10 hover:text-[#0891B2] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#06B6D4]/50`}
            >
              <Glyph className={icon} strokeWidth={2} />
            </a>
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0A0F24] px-2 py-1 text-[10.5px] font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {l.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export { LINK_KIND_NAME };
