/**
 * MUSHIN Design Tokens — canonical values.
 * Volumes 1 · 4D · 7 · 8 codified into TypeScript for engineering consumption.
 * Update this file when tokens change; do not scatter hex codes across components.
 */

/* ─────────────────────── Volume 8 · Design Tokens ─────────────────────── */

// 4px baseline spacing scale
export const spacing = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40, 9: 48, 10: 64, 11: 96,
} as const;

// Border radius scale
export const radius = { none: 0, sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 9999 } as const;

// Elevation / shadow scale
export const elevation = {
  none: "none",
  sm: "0 1px 2px rgb(15 23 42 / 0.06)",
  md: "0 4px 12px -2px rgb(15 23 42 / 0.10)",
  lg: "0 12px 32px -8px rgb(15 23 42 / 0.16)",
  xl: "0 24px 60px -16px rgb(15 23 42 / 0.22)",
  "2xl": "0 30px 80px -24px rgb(15 23 42 / 0.30)",
} as const;

// Motion durations (ms) — Volume 8 §3
export const motion = {
  instant: 80,
  fast: 150,
  base: 220,
  slow: 320,
  hero: 500,
} as const;

// Z-index layers
export const z = { base: 0, sticky: 20, dropdown: 30, drawer: 40, modal: 50, toast: 60 } as const;

/* ─────────────────────── Volume 1 · Semantic Colors ─────────────────────── */

// Semantic color roles — reference by role, not hex.
export const color = {
  surface: "#ffffff",
  surfaceMuted: "rgb(248 250 252)",
  border: "rgb(226 232 240)",
  borderStrong: "rgb(203 213 225)",

  textPrimary: "rgb(15 23 42)",
  textSecondary: "rgb(71 85 105)",
  textMuted: "rgb(100 116 139)",
  textPlaceholder: "rgb(148 163 184)",

  primary: "rgb(15 23 42)",
  primaryHover: "rgb(30 41 59)",
  primaryForeground: "#ffffff",

  accent: "rgb(79 70 229)",       // indigo-600
  accentHover: "rgb(67 56 202)",  // indigo-700
  accentSoft: "rgb(238 242 255)",

  success: "rgb(16 185 129)",
  successSoft: "rgb(236 253 245)",
  warning: "rgb(245 158 11)",
  warningSoft: "rgb(255 251 235)",
  danger: "rgb(239 68 68)",
  dangerSoft: "rgb(254 242 242)",
  info: "rgb(99 102 241)",
  infoSoft: "rgb(238 242 255)",

  // Platform colors (Pakistan creator context)
  platform: {
    instagram: "linear-gradient(135deg, rgb(236 72 153), rgb(251 146 60))",
    tiktok: "rgb(15 23 42)",
    youtube: "rgb(239 68 68)",
  },
} as const;

/* ─────────────────────── Volume 8 · Responsive Breakpoints ─────────────────────── */

export const breakpoints = {
  mobile: 640,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1440,
} as const;

/* ─────────────────────── Volume 7 · Typography Scale ─────────────────────── */

export const type = {
  // font sizes (px)
  size: { xs: 11, sm: 12, base: 13, md: 14, lg: 16, xl: 18, "2xl": 22, "3xl": 28, "4xl": 32, display: 40 },
  // weights
  weight: { regular: 400, medium: 500, semi: 600, bold: 700 },
  // tracking (letter-spacing) for display type
  tracking: { tight: "-0.03em", normal: "-0.01em", wide: "0.02em", eyebrow: "0.14em" },
  // line-heights
  lineHeight: { tight: 1.1, snug: 1.25, base: 1.5, relaxed: 1.65 },
  // families
  family: {
    sans:
      "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
} as const;

/* ─────────────────────── Volume 8 · Accessibility Contract ─────────────────────── */

export const a11y = {
  // Minimum contrast ratios (WCAG 2.2 AA)
  contrast: { text: 4.5, large: 3, ui: 3 },
  // Touch targets
  touchTarget: 44, // px min
  // Focus ring token — apply via `outline` or `ring`
  focusRing: "0 0 0 3px rgb(99 102 241 / 0.25)",
  // Reduced-motion media query — components should short-circuit long tweens
  prefersReducedMotion: "@media (prefers-reduced-motion: reduce)",
} as const;

/* ─────────────────────── Volume 4D · Component States ─────────────────────── */

export const componentStates = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "success",
  "error",
] as const;

/* Convenience: getters for use in inline styles */
export const t = {
  space: (n: keyof typeof spacing) => `${spacing[n]}px`,
  radius: (k: keyof typeof radius) => `${radius[k]}px`,
  duration: (k: keyof typeof motion) => `${motion[k]}ms`,
};
