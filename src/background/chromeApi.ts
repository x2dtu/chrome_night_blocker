import { systemZone } from "../core/time";
import type { ContentMessage } from "../shared/messages";
import type { BrowserApi, IdleState, TabInfo } from "./api";
import { IDLE_SECONDS } from "./controller";

const TICK_ALARM = "tick";
const REDIRECT_RULE_ID = 1;
/** Installed extensions can't run alarms sooner than this; shorter waits also get a timer. */
const MIN_ALARM_DELAY_MS = 30_000;

/** The real browser, via chrome.* APIs. [onTimer] runs when a short-delay timer fires. */
export function chromeApi(onTimer: () => void): BrowserApi {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const blockPageBase = chrome.runtime.getURL("block/block.html");

  return {
    blockPageBase,
    now: () => Date.now(),
    zone: () => systemZone(),

    async queryTabs(): Promise<TabInfo[]> {
      const tabs = await chrome.tabs.query({});
      return tabs
        .filter((t) => t.id !== undefined && t.id !== chrome.tabs.TAB_ID_NONE)
        .map((t) => ({
          id: t.id!,
          windowId: t.windowId,
          url: t.pendingUrl || t.url || "",
          active: t.active,
          audible: t.audible ?? false,
        }));
    },

    async focusedWindowId() {
      try {
        const w = await chrome.windows.getLastFocused();
        return w.focused && w.id !== undefined ? w.id : null;
      } catch {
        return null; // no windows
      }
    },

    idleState: () => chrome.idle.queryState(IDLE_SECONDS) as Promise<IdleState>,

    async updateTabUrl(tabId, url) {
      try {
        await chrome.tabs.update(tabId, { url });
      } catch (e) {
        console.warn("[Night Blocker] Couldn't update tab", tabId, e); // tab closed meanwhile
      }
    },

    sendToTab(tabId, message: ContentMessage) {
      // The content script may not be there (page still loading, or opened before install).
      chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
    },

    scheduleTick(at) {
      void chrome.alarms.create(TICK_ALARM, { when: at });
      clearTimeout(timer);
      const delay = at - Date.now();
      if (delay < MIN_ALARM_DELAY_MS) timer = setTimeout(onTimer, Math.max(0, delay));
    },

    async setRedirectRules(domains) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [REDIRECT_RULE_ID],
        addRules: domains.length === 0 ? [] : [{
          id: REDIRECT_RULE_ID,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect: { regexSubstitution: `${blockPageBase}#\\0` },
          },
          condition: {
            regexFilter: "^.*$",
            requestDomains: [...domains],
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
          },
        }],
      });
    },

    async load(key) {
      return (await chrome.storage.local.get(key))[key];
    },

    async save(items) {
      await chrome.storage.local.set(items);
    },
  };
}
