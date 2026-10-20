import { ProviderError } from "./types";

type Options = { apiKey: string; fetch?: typeof fetch; recentVideos: number };

async function get(doFetch: typeof fetch, url: string, o: { notFound?: unknown } = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url);
  } catch (err) {
    throw new ProviderError(true, "provider", `YouTube is unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.ok) return res.json();
  if (res.status === 404 && "notFound" in o) return o.notFound;
  const text = await res.text();
  if (res.status === 403 && /quotaExceeded|dailyLimitExceeded/.test(text)) throw new ProviderError(false, "quota", "YouTube daily quota used up");
  if (res.status === 400 || res.status === 403) throw new ProviderError(false, "not_configured", `YouTube refused the request (HTTP ${res.status})`);
  throw new ProviderError(res.status >= 500, "provider", `YouTube answered HTTP ${res.status}`);
}

/**
 * Channel by handle, then its uploads playlist and the latest videos' statistics: 3 quota units, $0.
 * An unknown handle returns the API's empty channel list and `videos: null`.
 */
export async function fetchYouTubeChannel(o: Options & { handle: string }): Promise<{ channel: unknown; videos: unknown }> {
  const doFetch = o.fetch ?? fetch;
  const api = "https://www.googleapis.com/youtube/v3";
  const key = `key=${encodeURIComponent(o.apiKey)}`;
  const channel = (await get(doFetch, `${api}/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(o.handle)}&${key}`)) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { channel, videos: null };
  // A channel without public uploads has an uploads playlist id that answers 404 (seen 2026-10-20): no videos.
  const playlist = (await get(doFetch, `${api}/playlistItems?part=contentDetails&maxResults=${o.recentVideos}&playlistId=${encodeURIComponent(uploads)}&${key}`, { notFound: { items: [] } })) as {
    items?: { contentDetails?: { videoId?: string } }[];
  };
  const ids = (playlist.items ?? []).map((i) => i.contentDetails?.videoId).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return { channel, videos: { items: [] } };
  const videos = await get(doFetch, `${api}/videos?part=snippet,statistics,contentDetails&id=${ids.map(encodeURIComponent).join(",")}&${key}`);
  return { channel, videos };
}
