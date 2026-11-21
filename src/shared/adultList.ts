// Loads the bundled adult-site list once per page / worker, only when a block set uses it.

import { setAdultSiteMatcher } from "../core/adultSites";
import { DomainHashSet } from "../core/domainHashSet";
import type { BlockSet } from "../core/model";

/** Source: The Block List Project porn list (public domain / MIT), https://github.com/blocklistproject/Lists */
export const ADULT_LIST_DATE = "July 2026";
export const ADULT_LIST_PATH = "data/adult_domains.bin";

let loading: Promise<DomainHashSet> | null = null;
let loaded: DomainHashSet | null = null;

export function usesAdultList(sets: readonly BlockSet[]): boolean {
  return sets.some((s) => s.targets.some((t) => t.kind === "adult"));
}

/** Loads the list (once) and installs it for isAdultSite(). */
export function ensureAdultList(fetchList: () => Promise<ArrayBuffer>): Promise<DomainHashSet> {
  if (!loading) {
    loading = fetchList().then((buffer) => {
      const list = DomainHashSet.parse(buffer);
      loaded = list;
      setAdultSiteMatcher((host) => list.containsHostOrParent(host));
      return list;
    });
    loading.catch((e: unknown) => {
      console.error("[Night Blocker] Couldn't load the adult-site list", e);
      loading = null; // try again next time
    });
  }
  return loading;
}

export function isAdultListLoaded(): boolean {
  return loaded !== null;
}

/** "about 937,000" */
export function adultListSizeLabel(): string {
  const n = loaded?.size ?? 937_000;
  return `about ${(Math.round(n / 1000) * 1000).toLocaleString("en-US")}`;
}

/** Extension pages: fetch the bundled file. */
export const fetchBundledList = () => fetch(chrome.runtime.getURL(ADULT_LIST_PATH)).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
});

/** Tests only. */
export function resetAdultList(): void {
  loading = null;
  loaded = null;
  setAdultSiteMatcher(null);
}
