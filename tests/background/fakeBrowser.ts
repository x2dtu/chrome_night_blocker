import type { BrowserApi, IdleState, TabInfo } from "../../src/background/api";
import { type Instant, UTC, type Zone } from "../../src/core/time";
import type { ContentMessage } from "../../src/shared/messages";

export const BASE = "chrome-extension://test/block/block.html";

/** An in-memory browser for driving the Controller. */
export class FakeBrowser implements BrowserApi {
  readonly blockPageBase = BASE;
  time: Instant;
  tz: Zone = UTC;
  tabs: TabInfo[] = [];
  focused: number | null = 1;
  idle: IdleState = "active";
  storage: Record<string, unknown> = {};
  sent: { tabId: number; message: ContentMessage }[] = [];
  tickAt: Instant | null = null;
  rules: readonly string[] = [];
  updates: { tabId: number; url: string }[] = [];

  constructor(start: Instant) {
    this.time = start;
  }

  now = () => this.time;
  zone = () => this.tz;
  queryTabs = async () => this.tabs.map((t) => ({ ...t }));
  focusedWindowId = async () => this.focused;
  idleState = async () => this.idle;

  async updateTabUrl(tabId: number, url: string) {
    this.updates.push({ tabId, url });
    this.tabs = this.tabs.map((t) => (t.id === tabId ? { ...t, url } : t));
  }

  sendToTab(tabId: number, message: ContentMessage) {
    this.sent.push({ tabId, message });
  }

  scheduleTick(at: Instant) {
    this.tickAt = at;
  }

  async setRedirectRules(domains: readonly string[]) {
    this.rules = domains;
  }

  load = async (key: string) => structuredClone(this.storage[key]);

  async save(items: Record<string, unknown>) {
    Object.assign(this.storage, structuredClone(items));
  }

  // --- test helpers ---

  /** Opens [url] in a new active tab of window 1. */
  open(id: number, url: string, windowId = 1) {
    this.tabs = this.tabs.map((t) => (t.windowId === windowId ? { ...t, active: false } : t));
    this.tabs.push({ id, windowId, url, active: true, audible: false });
  }

  activate(id: number) {
    const w = this.tabs.find((t) => t.id === id)!.windowId;
    this.tabs = this.tabs.map((t) => (t.windowId === w ? { ...t, active: t.id === id } : t));
  }

  navigate(id: number, url: string) {
    this.tabs = this.tabs.map((t) => (t.id === id ? { ...t, url } : t));
  }

  urlOf(id: number) {
    return this.tabs.find((t) => t.id === id)!.url;
  }
}
