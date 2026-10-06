type Props = {
  variant?: "default" | "dark" | "mono";
  showWordmark?: boolean;
  size?: number;
};

/**
 * MUSHIN — custom-lettered capital M mark.
 *
 * Construction: two tapered pillars (thick at base, tighter at top) framing
 * two mirrored inner valleys; a hairline node at the intersection reads,
 * from a distance, as a signal emerging from noise. All lines optical, no
 * flourishes — the mark should stay legible at 16×16.
 */
export function LogoMark({ variant = "default", size = 34 }: { variant?: "default" | "dark" | "mono"; size?: number }) {
  const isDark = variant === "dark";
  const isMono = variant === "mono";
  const gradId = `mushin-M-fill-${variant}`;
  const nodeId = `mushin-M-node-${variant}`;
  const monoFill = isDark ? "#ffffff" : "#0F172A";
  const fill = isMono ? monoFill : `url(#${gradId})`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-label="Mushin"
      role="img"
    >
      <defs>
        <linearGradient id={gradId} x1="12" y1="12" x2="88" y2="88" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="55%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
        <radialGradient id={nodeId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Custom-lettered M — filled single path.
          Outer legs taper toward the top; inner V-cutouts create sharp elegant terminals. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="
          M 8 88
          L 26 12
          L 38 12
          L 50 52
          L 62 12
          L 74 12
          L 92 88
          L 78 88
          L 68 42
          L 54 74
          L 46 74
          L 32 42
          L 22 88
          Z
        "
        fill={fill}
      />

      {/* Hidden signal — a soft node at the M's meeting point, reading as a hint
          of intelligence surfacing from the letterform. Skipped in mono. */}
      {!isMono && (
        <>
          <circle cx="50" cy="52" r="6" fill={`url(#${nodeId})`} />
          <circle cx="50" cy="52" r="1.6" fill="#ffffff" opacity="0.92" />
        </>
      )}
    </svg>
  );
}

export function Logo({ variant = "default", showWordmark = true, size = 30 }: Props) {
  const wordColor = variant === "dark" ? "#ffffff" : "#0F172A";
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark variant={variant} size={size} />
      {showWordmark && (
        <span
          style={{
            color: wordColor,
            fontWeight: 700,
            letterSpacing: "0.14em",
            fontSize: "0.875rem",
          }}
        >
          MUSHIN
        </span>
      )}
    </div>
  );
}
