import { type AppState, EMPTY_STATE, deserializeState, serializeState } from "../core/appState";
import type { Decision } from "../core/decision";
import { BlockEngine } from "../core/engine";
import { hostFromUrl } from "../core/hosts";
import type { BlockSet } from "../core/model";
import { hashPin, isValidPin, verifyPin } from "../core/pin";
import { addSet, cancelPending, deleteSet, maintain, nextPendingAt, requestEdit, setById, suspend } from "../core/stateActions";
import type { Instant, Zone } from "../core/time";
import { blockPageUrl, originalFromBlockUrl } from "../shared/blockUrl";
import type { ActionRequest, ActionResult, BlockPageModel, ContinueResult } from "../shared/messages";
import type { BrowserApi, TabInfo } from "./api";
import { bannerFor, blockPageModel } from "./presentation";

/** Heartbeat alarm period; while it's missing, the laptop was asleep (or the browser closed). */
export const HEARTBEAT_MS = 30_000;
/** A gap this long since the last update means nobody was there: it doesn't count as time on the site. */
export const MAX_GAP_MS = 90_000;
/** Re-check at least this often, to catch clock changes. */
export const MAX_TICK_MS = 60_000;
/** No keyboard/mouse input for this long counts as idle — unless the tab is playing audio. */
export const IDLE_SECONDS = 180;

/** A navigation that triggered the update: [url] is where [tabId] is going. */
export interface Navigation {
  readonly tabId: number;
  readonly url: string;
}

/** What the engine snapshot needs beyond AppState.usage. */
interface Runtime {
  readonly foreground: string | null;
  readonly idle?: boolean;
  readonly lastAccrualAt: Instant | null;
}

interface Context {
  readonly now: Instant;
  readonly tabs: readonly TabInfo[];
  /** The active tab of the focused window. */
  readonly foregroundTab: TabInfo | null;
}

/**
 * The background worker's brain: keeps the engine in step with what the user is looking at,
 * redirects tabs to and from the block page, persists state and schedules the next check.
 *
 * Everything runs through one queue so async browser calls never interleave. Each update re-reads
 * tabs, focus and idle state from the browser instead of tracking them, so nothing is lost when
 * the service worker is stopped and restarted.
 */
export class Controller {
  private state: AppState = EMPTY_STATE;
  private engine!: BlockEngine;
  private zone!: Zone;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private savedState = "";
  private savedRuntime = "";
  private savedRules: string | null = null;

  constructor(private readonly api: BrowserApi) {}

  /** Re-checks everything. Call on any browser event; pass the navigation if there is one. */
  refresh(nav?: Navigation): Promise<void> {
    return this.run(async () => {
      await this.update(nav);
    });
  }

  getBlockPage(url: string): Promise<BlockPageModel> {
    return this.run(async () => {
      const host = hostFromUrl(url);
      if (host === null) return blockPageModel({ type: "allow" }, "", this.state);
      return blockPageModel(this.engine.evaluate(host, this.api.now()), host, this.state);
    });
  }

  /** Continue on the block page in [tabId]. Unlocks and sends the tab back to the site. */
  continueFrom(tabId: number): Promise<ContinueResult> {
    return this.run(async () => {
      const ctx = await this.update();
      const tab = ctx.foregroundTab;
      if (!tab || tab.id !== tabId) return { ok: false, reason: "The block page isn't the tab in use" };
      const original = originalFromBlockUrl(this.api.blockPageBase, tab.url);
      if (original === null || hostFromUrl(original) !== this.engine.foreground) return { ok: false, reason: "Not a block page" };
      const decision = this.engine.unlock(ctx.now);
      await this.update(); // sends the tab back now that it's allowed
      return decision.type === "inSession" || decision.type === "allow" ? { ok: true } : { ok: false, reason: decision.type };
    });
  }

  /** Applies a state change (from a UI action) and re-checks. */
  mutate(fn: (state: AppState, now: Instant, zone: Zone) => AppState): Promise<AppState> {
    return this.run(async () => {
      this.state = fn(this.state, this.api.now(), this.zone);
      this.engine.updateSets(this.state.sets, this.api.now());
      await this.update();
      return this.state;
    });
  }

  /** A change from the settings UI. Checks the PIN, then applies it. */
  action(request: ActionRequest): Promise<ActionResult> {
    return this.run(async () => {
      const now = this.api.now();
      try {
        const result = await this.applyAction(request, now);
        if (result.ok) {
          this.engine.updateSets(this.state.sets, now);
          await this.update();
        }
        return result;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  private async applyAction(r: ActionRequest, now: Instant): Promise<ActionResult> {
    if (r.type === "createSet") {
      if (r.pin !== null && !isValidPin(r.pin)) return { ok: false, error: "PIN must be 4–12 digits" };
      const pinHash = r.pin === null ? null : await hashPin(r.pin);
      this.state = addSet(this.state, { ...r.set, pinHash, suspendedUntil: null });
      return { ok: true };
    }
    if (r.type === "cancelPending") {
      this.state = cancelPending(this.state, r.setId); // keeps things as strict as they are: no PIN
      return { ok: true };
    }
    const setId = r.type === "editSet" ? r.set.id : r.setId;
    const current = setById(this.state, setId);
    if (!current) return { ok: false, error: "That block set no longer exists" };
    if (current.pinHash !== null && !(await verifyPin(r.pin ?? "", current.pinHash))) {
      return { ok: false, error: "Wrong PIN" };
    }
    switch (r.type) {
      case "verifyPin":
        return { ok: true };
      case "editSet": {
        const proposed = { ...r.set, pinHash: current.pinHash, suspendedUntil: current.suspendedUntil };
        const [state, outcome] = requestEdit(this.state, proposed, now, this.zone);
        this.state = state;
        return { ok: true, outcome };
      }
      case "setEnabled": {
        const [state, outcome] = requestEdit(this.state, { ...current, enabled: r.enabled }, now, this.zone);
        this.state = state;
        return { ok: true, outcome };
      }
      case "suspend": {
        const [state, check] = suspend(this.state, setId, now, this.zone);
        this.state = state;
        return check.type === "allowed" ? { ok: true, suspension: check } : { ok: false, error: `Can't pause right now (${check.type})` };
      }
      case "deleteSet":
        if (current.enabled) return { ok: false, error: "Turn the block set off before deleting it" };
        this.state = deleteSet(this.state, setId);
        return { ok: true };
    }
  }

  addSet(set: BlockSet): Promise<AppState> {
    return this.mutate((s) => addSet(s, set));
  }

  getState(): Promise<AppState> {
    return this.run(async () => this.state);
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await this.load();
      return fn();
    });
    this.queue = result.catch((e: unknown) => console.error("[Night Blocker]", e));
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const [rawState, rawRuntime] = await Promise.all([this.api.load("state"), this.api.load("runtime")]);
    try {
      this.state = deserializeState(rawState);
    } catch (e) {
      // Keep what couldn't be read rather than silently overwriting it.
      console.error("[Night Blocker] Couldn't read saved state; keeping a copy and starting fresh", e);
      await this.api.save({ [`state-unreadable-${this.api.now()}`]: rawState });
      this.state = EMPTY_STATE;
    }
    const runtime = (rawRuntime ?? {}) as Partial<Runtime>;
    this.zone = this.api.zone();
    this.engine = new BlockEngine(this.zone, this.state.sets, {
      usage: this.state.usage,
      foreground: runtime.foreground ?? null,
      idle: runtime.idle ?? false,
      lastAccrualAt: runtime.lastAccrualAt ?? null,
    });
    this.savedState = JSON.stringify(serializeState(this.state));
    this.savedRuntime = JSON.stringify(runtime);
    this.loaded = true;
  }

  private async update(nav?: Navigation): Promise<Context> {
    const now = this.api.now();

    // Windows are local time: rebuild the engine if the time zone changed.
    const zone = this.api.zone();
    if (zone.id !== this.zone.id) {
      this.zone = zone;
      this.engine = new BlockEngine(zone, this.state.sets, this.engine.snapshot());
    }

    // Asleep / browser closed / worker starved: the time since we last looked doesn't count.
    const snap = this.engine.snapshot();
    if (snap.foreground !== null && snap.lastAccrualAt !== null && now - snap.lastAccrualAt > MAX_GAP_MS) {
      this.engine.onForegroundChanged(null, snap.lastAccrualAt);
    }

    // Pending changes and streaks.
    this.state = maintain(this.state, now, this.zone);
    if (this.state.sets !== this.engine.sets) this.engine.updateSets(this.state.sets, now);

    const [rawTabs, focusedWindow, idle] = await Promise.all([
      this.api.queryTabs(), this.api.focusedWindowId(), this.api.idleState(),
    ]);
    const tabs = rawTabs.map((t) => (nav && t.id === nav.tabId && !this.isBlockPage(t.url) ? { ...t, url: nav.url } : t));
    const foregroundTab = tabs.find((t) => t.active && t.windowId === focusedWindow) ?? null;
    const foreground = this.foregroundHost(foregroundTab);
    const isIdle = foreground !== null && (idle === "locked" || (idle === "idle" && !foregroundTab!.audible));
    if (foreground !== this.engine.foreground || isIdle !== this.engine.idle) {
      this.engine.onForegroundChanged(foreground, now, isIdle);
    }
    this.engine.tick(now);

    // Banners wait until the user is back (a warning still due then is sent then).
    if (foregroundTab && foreground !== null && !isIdle && !this.isBlockPage(foregroundTab.url)) {
      const banner = bannerFor(this.engine.collectTimeWarnings(now), this.engine.collectReminders(now), foreground, this.state);
      if (banner) this.api.sendToTab(foregroundTab.id, banner);
    }

    await this.redirectTabs(tabs, foregroundTab, nav, now);

    this.state = { ...this.state, usage: this.engine.usage };
    await this.persist();
    await this.updateRedirectRules(now);
    this.scheduleNext(now);
    return { now, tabs, foregroundTab };
  }

  /**
   * Blocked sites go to the block page in every tab. Soft-gated sites only in the tab in use (or
   * the tab navigating there) — background tabs are checked when you switch to them, so they
   * don't lose their page. Block pages whose site is allowed again go back to it.
   */
  private async redirectTabs(tabs: readonly TabInfo[], foregroundTab: TabInfo | null, nav: Navigation | undefined, now: Instant) {
    for (const tab of tabs) {
      const original = originalFromBlockUrl(this.api.blockPageBase, tab.url);
      if (original !== null) {
        const host = hostFromUrl(original);
        if (host !== null && isOpen(this.engine.evaluate(host, now))) await this.api.updateTabUrl(tab.id, original);
        continue;
      }
      const host = hostFromUrl(tab.url);
      if (host === null) continue;
      const d = this.engine.evaluate(host, now);
      const inUse = tab.id === foregroundTab?.id || tab.id === nav?.tabId;
      if (d.type === "blocked" || (d.type === "softGate" && inUse)) {
        await this.api.updateTabUrl(tab.id, blockPageUrl(this.api.blockPageBase, tab.url));
      }
    }
  }

  /** The site the user is using: the focused tab's host (or the blocked site behind the block page). */
  private foregroundHost(tab: TabInfo | null): string | null {
    if (!tab) return null;
    const original = originalFromBlockUrl(this.api.blockPageBase, tab.url);
    return hostFromUrl(original ?? tab.url);
  }

  private isBlockPage(url: string): boolean {
    return originalFromBlockUrl(this.api.blockPageBase, url) !== null;
  }

  private async persist(): Promise<void> {
    const items: Record<string, unknown> = {};
    const stored = serializeState(this.state);
    const stateJson = JSON.stringify(stored);
    if (stateJson !== this.savedState) {
      items.state = stored;
      this.savedState = stateJson;
    }
    const snap = this.engine.snapshot();
    const runtime: Runtime = { foreground: snap.foreground, idle: snap.idle ?? false, lastAccrualAt: snap.lastAccrualAt };
    const runtimeJson = JSON.stringify(runtime);
    if (runtimeJson !== this.savedRuntime) {
      items.runtime = runtime;
      this.savedRuntime = runtimeJson;
    }
    if (Object.keys(items).length > 0) await this.api.save(items);
  }

  /** Fast path: hard-blocked (or used-up) website domains are redirected before the page loads. */
  private async updateRedirectRules(now: Instant): Promise<void> {
    const domains = new Set<string>();
    for (const set of this.state.sets) {
      for (const t of set.targets) {
        if (t.kind === "website" && this.engine.evaluate(t.domain, now).type === "blocked") domains.add(t.domain);
      }
    }
    const sorted = [...domains].sort();
    const key = sorted.join(",");
    if (key === this.savedRules) return;
    await this.api.setRedirectRules(sorted);
    this.savedRules = key;
  }

  private scheduleNext(now: Instant): void {
    const candidates = [this.engine.nextEvaluationAt(now), nextPendingAt(this.state)].filter((t): t is number => t !== null);
    const next = candidates.length > 0 ? Math.min(...candidates) + 50 : now + MAX_TICK_MS;
    this.api.scheduleTick(Math.max(now, Math.min(next, now + MAX_TICK_MS)));
  }
}

function isOpen(d: Decision): boolean {
  return d.type === "allow" || d.type === "inSession";
}
