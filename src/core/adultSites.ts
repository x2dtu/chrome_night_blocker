// The adult-site list (Phase 6) is large and loaded at startup; until then nothing matches.

let matcher: ((host: string) => boolean) | null = null;

/** Installs the list lookup (or clears it with null). */
export function setAdultSiteMatcher(fn: ((host: string) => boolean) | null): void {
  matcher = fn;
}

/** True if [host] or one of its parent domains is on the adult-site list. */
export function isAdultSite(host: string): boolean {
  return matcher?.(host) ?? false;
}
