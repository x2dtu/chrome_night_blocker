// The block page is block/block.html#<original URL>. The original URL goes after "#" unencoded,
// so the declarativeNetRequest redirect (which can't encode) and our own redirects agree.

export function blockPageUrl(base: string, original: string): string {
  return `${base}#${original}`;
}

/** The blocked URL if [url] is the block page, else null. */
export function originalFromBlockUrl(base: string, url: string): string | null {
  return url.startsWith(`${base}#`) ? url.slice(base.length + 1) : null;
}
