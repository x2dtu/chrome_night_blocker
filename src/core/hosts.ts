// Turning URLs and user input into hosts / domains, and matching hosts against domains.

/** The lowercase host of an http(s) page URL, or null for anything else (chrome://, file:, the block page…). */
export function hostFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/\.$/, "");
  return host === "" ? null : host;
}

/**
 * Extracts the lowercase host from text a user typed, e.g. "https://www.Reddit.com/r/all?x=1" →
 * "www.reddit.com", "reddit.com" → "reddit.com". Returns null for text that isn't a site (such as
 * "how to sleep better" or "reddit"). International names come back in punycode, the same form
 * the browser reports for navigations.
 */
export function hostFromUserInput(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (t === "" || /\s/.test(t)) return null;
  const host = hostFromUrl(t.includes("://") ? t : `http://${t}`);
  if (host === null || !host.includes(".") || host.startsWith(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/** Normalizes user-entered website text to a domain for a block set, or null if invalid. Drops a leading "www.". */
export function domainFromUserInput(text: string): string | null {
  return hostFromUserInput(text)?.replace(/^www\./, "") ?? null;
}

/** [domain] covers itself and all of its subdomains: reddit.com matches old.reddit.com, not notreddit.com. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
