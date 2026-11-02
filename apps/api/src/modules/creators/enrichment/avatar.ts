// Profile photos are copied because platform photo links expire within days. The link comes from scraped data,
// which is hostile input (SRS §5.3): only HTTPS links on the platforms' own image hosts are fetched, redirects are not
// followed (no detour to internal addresses), only raster image types are kept (an SVG can carry script), and reading
// stops at the size limit. The bytes must start like the declared type (security audit 2026-10-27): a host that
// labels HTML or script as an image is refused, not stored.

const IMAGE_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net", ".tiktokcdn.com", ".tiktokcdn-us.com", ".ggpht.com", ".ytimg.com", ".googleusercontent.com"];
const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_AVATAR_BYTES = 2_000_000;

function startsLike(contentType: string, b: Uint8Array): boolean {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (contentType === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (contentType === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50); // RIFF....WEBP
}

export function isAllowedAvatarUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  const host = u.hostname.toLowerCase();
  return IMAGE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function fetchAvatar(
  url: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  maxBytes = MAX_AVATAR_BYTES,
): Promise<{ bytes: Uint8Array; contentType: string; ext: string } | null> {
  if (!isAllowedAvatarUrl(url)) return null;
  const res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (res.status !== 200 || !res.body) return null;
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = EXTENSIONS[contentType];
  if (!ext) return null;
  if (Number(res.headers.get("content-length") ?? "0") > maxBytes) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  if (!startsLike(contentType, bytes)) return null;
  return { bytes, contentType, ext };
}
