type Props = {
  variant?: "default" | "dark" | "mono";
  showWordmark?: boolean;
  size?: number;
};

/**
 * MUSHIN's mark (owner, 17 Nov): the supplied blue "M" with rising bars, served from /mushin-logo-64.png (a 64 px copy of
 * the supplied artwork, so it stays sharp at 32 px on dense screens). It reads on light and dark backgrounds alike, so
 * every variant uses the same image.
 */
export function LogoMark({ size = 34 }: { variant?: "default" | "dark" | "mono"; size?: number }) {
  return <img src="/mushin-logo-64.png" width={size} height={size} alt="MUSHIN" className="shrink-0 object-contain" draggable={false} />;
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
