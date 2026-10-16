/**
 * HTTP headers for the static app host (audit SEC-14). The build writes them to dist/_headers, the format Cloudflare
 * Pages and Netlify read; any other host (a container with Caddy or nginx) must send the same values. The API is reached
 * same-origin under /api (the host proxies it), so the only other origin the page talks to is Supabase Auth.
 *
 * style-src allows inline styles: index.html has one small <style> block and the chart component injects its colours.
 * Scripts are never inline and never evaluated. Images may come from any HTTPS origin (creator avatars).
 */
export function contentSecurityPolicy(supabaseUrl: string): string {
  const supabase = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function securityHeaders(supabaseUrl: string): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(supabaseUrl),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** dist/_headers: security headers everywhere; hashed assets cached for a year, the page itself never cached. */
export function headersFile(supabaseUrl: string): string {
  const all = Object.entries(securityHeaders(supabaseUrl)).map(([k, v]) => `  ${k}: ${v}`);
  return [
    "/*",
    ...all,
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "/",
    "  Cache-Control: no-cache",
    "/index.html",
    "  Cache-Control: no-cache",
    "",
  ].join("\n");
}
