import type { SVGProps } from "react";

/**
 * Platform marks in each brand's own colours (owner, 25 Nov: "make them more colourful, use their own colour so they are
 * visible"): Instagram's gradient, YouTube red, TikTok black with its cyan and pink. One component for cards, tables,
 * filters and the staff console, so the platforms look the same everywhere.
 */
export type Platform = "instagram" | "youtube" | "tiktok";
export const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
export const PLATFORM_COLOR: Record<Platform, string> = { instagram: "#E1306C", youtube: "#FF0000", tiktok: "#010101" };

function Glyph({ platform, ...p }: { platform: Platform } & SVGProps<SVGSVGElement>) {
  if (platform === "youtube")
    return (
      <svg viewBox="0 0 24 24" aria-hidden {...p}>
        <path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8z" />
        <path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4z" />
      </svg>
    );
  if (platform === "tiktok")
    return (
      <svg viewBox="0 0 24 24" aria-hidden {...p}>
        <rect width="24" height="24" rx="6" fill="#010101" />
        <path fill="#25F4EE" d="M15.2 5.3a3.6 3.6 0 0 1-.9-2.3h-2.6v10.4a2.2 2.2 0 0 1-2.2 2.1 2.2 2.2 0 0 1-2.2-2.2c0-1.5 1.4-2.5 2.8-2.1V8.6c-2.9-.4-5.4 1.9-5.4 4.7 0 2.8 2.3 4.8 4.8 4.8 2.6 0 4.8-2.1 4.8-4.8V8.1a6.1 6.1 0 0 0 3.6 1.2V6.7s-1.6.1-2.7-1.4z" transform="translate(-.6 -.4)" />
        <path fill="#FE2C55" d="M15.2 5.3a3.6 3.6 0 0 1-.9-2.3h-2.6v10.4a2.2 2.2 0 0 1-2.2 2.1 2.2 2.2 0 0 1-2.2-2.2c0-1.5 1.4-2.5 2.8-2.1V8.6c-2.9-.4-5.4 1.9-5.4 4.7 0 2.8 2.3 4.8 4.8 4.8 2.6 0 4.8-2.1 4.8-4.8V8.1a6.1 6.1 0 0 0 3.6 1.2V6.7s-1.6.1-2.7-1.4z" transform="translate(.6 .4)" />
        <path fill="#fff" d="M15.2 5.3a3.6 3.6 0 0 1-.9-2.3h-2.6v10.4a2.2 2.2 0 0 1-2.2 2.1 2.2 2.2 0 0 1-2.2-2.2c0-1.5 1.4-2.5 2.8-2.1V8.6c-2.9-.4-5.4 1.9-5.4 4.7 0 2.8 2.3 4.8 4.8 4.8 2.6 0 4.8-2.1 4.8-4.8V8.1a6.1 6.1 0 0 0 3.6 1.2V6.7s-1.6.1-2.7-1.4z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...p}>
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0" stopColor="#FDF497" />
          <stop offset=".05" stopColor="#FDF497" />
          <stop offset=".45" stopColor="#FD5949" />
          <stop offset=".6" stopColor="#D6249F" />
          <stop offset=".9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6.5" fill="url(#ig-grad)" />
      <rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.3" cy="7.7" r="1" fill="#fff" />
    </svg>
  );
}

/** The brand mark alone (a decorative icon next to a platform name). */
export function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: Platform; className?: string }) {
  return <Glyph platform={platform} className={`shrink-0 ${className}`} />;
}

/** Mark + name in a white pill: readable on photos and light backgrounds alike. */
export function PlatformPill({ platform, className = "" }: { platform: Platform; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-slate-800 shadow-sm ${className}`}>
      <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
      {PLATFORM_LABEL[platform]}
    </span>
  );
}
