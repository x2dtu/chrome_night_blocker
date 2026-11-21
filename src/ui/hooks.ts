import { useEffect, useState } from "preact/hooks";
import { type AppState, deserializeState } from "../core/appState";
import { ensureAdultList, fetchBundledList, isAdultListLoaded } from "../shared/adultList";
import type { ActionRequest, ActionResult } from "../shared/messages";

/** The stored state, live: re-reads when the worker saves. Null until loaded. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => chrome.storage.local.get("state").then((r) => alive && setState(deserializeState(r.state)));
    void read();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && "state" in changes) void read();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);
  return state;
}

/** Loads the adult-site list when [needed]; returns whether it's ready (re-renders when it is). */
export function useAdultList(needed: boolean): boolean {
  const [ready, setReady] = useState(isAdultListLoaded());
  useEffect(() => {
    if (needed && !ready) void ensureAdultList(fetchBundledList).then(() => setReady(true), () => undefined);
  }, [needed]);
  return ready;
}

/** Current time, refreshed every [periodMs], so status lines stay current. */
export function useNow(periodMs = 15_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(t);
  }, [periodMs]);
  return now;
}

/** The part of the URL after "#", live. */
export function useHash(): string {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function navigate(route: string): void {
  location.hash = route;
  window.scrollTo(0, 0);
}

/** Sends a settings action to the background worker. */
export async function act(request: ActionRequest): Promise<ActionResult> {
  try {
    return ((await chrome.runtime.sendMessage(request)) as ActionResult | undefined) ?? { ok: false, error: "No answer from Night Blocker" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
