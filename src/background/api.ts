import type { Instant, Zone } from "../core/time";
import type { ContentMessage } from "../shared/messages";

export interface TabInfo {
  readonly id: number;
  readonly windowId: number;
  /** The URL being loaded if a navigation is pending, else the current URL. */
  readonly url: string;
  readonly active: boolean;
  readonly audible: boolean;
}

export type IdleState = "active" | "idle" | "locked";

/** Everything the controller needs from the browser. Faked in tests. */
export interface BrowserApi {
  /** chrome-extension://<id>/block/block.html */
  readonly blockPageBase: string;
  now(): Instant;
  zone(): Zone;
  queryTabs(): Promise<TabInfo[]>;
  /** The focused browser window, or null when another app has focus. */
  focusedWindowId(): Promise<number | null>;
  idleState(): Promise<IdleState>;
  updateTabUrl(tabId: number, url: string): Promise<void>;
  sendToTab(tabId: number, message: ContentMessage): void;
  /** Make sure the controller is refreshed at [at] (replaces the previous request). */
  scheduleTick(at: Instant): void;
  /** Redirect main-frame requests to these domains (and subdomains) straight to the block page. */
  setRedirectRules(domains: readonly string[]): Promise<void>;
  load(key: string): Promise<unknown>;
  save(items: Record<string, unknown>): Promise<void>;
}
