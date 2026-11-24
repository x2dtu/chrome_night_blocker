// Site icons for extension pages. First choice is the browser's own favicon cache (Chrome's
// /_favicon/ endpoint). That only knows sites you've loaded in this profile — and blocked sites
// often never load — and for anything else it returns a generic globe rather than failing. So we
// compare against that globe and, if it's what we got, use the site's own /favicon.ico instead
// (asking only the site itself, no third-party icon service). If that fails too, the caller
// shows no icon.

/** Fetches bytes, or null on any failure. */
export type FetchBytes = (url: string) => Promise<Uint8Array | null>;

export function cacheUrl(pageUrl: string, size: number): string {
  return `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

export function directUrl(pageUrl: string): string | null {
  try {
    const u = new URL(pageUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? `${u.origin}/favicon.ico` : null;
  } catch {
    return null;
  }
}

/** Any page that can't be in the cache, to learn what the generic icon looks like. */
const UNKNOWN_PAGE = "https://night-blocker-no-such-site.invalid/";

export function makeFaviconResolver(fetchBytes: FetchBytes, hasCache: boolean) {
  const generic = new Map<number, Promise<Uint8Array | null>>();
  const results = new Map<string, Promise<string | null>>();

  const resolve = async (pageUrl: string, size: number): Promise<string | null> => {
    const direct = directUrl(pageUrl);
    if (!hasCache) return direct;
    const url = cacheUrl(pageUrl, size);
    let g = generic.get(size);
    if (!g) {
      g = fetchBytes(cacheUrl(UNKNOWN_PAGE, size));
      generic.set(size, g);
    }
    const [mine, genericBytes] = await Promise.all([fetchBytes(url), g]);
    if (mine === null) return direct;
    return genericBytes !== null && sameBytes(mine, genericBytes) ? direct : url;
  };

  /** The icon URL to show for [pageUrl], or null for none. Cached per page and size. */
  return (pageUrl: string, size: number): Promise<string | null> => {
    const key = `${size}|${pageUrl}`;
    let r = results.get(key);
    if (!r) {
      r = resolve(pageUrl, size);
      results.set(key, r);
    }
    return r;
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const fetchBytes: FetchBytes = async (url) => {
  try {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
};

/** For extension pages in this browser. */
export const faviconFor = makeFaviconResolver(fetchBytes, true);
