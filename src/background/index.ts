// Background service worker. MV3 workers are stopped when idle, so all state lives in
// chrome.storage and all timing in chrome.alarms. Listeners are registered synchronously at the
// top level so they fire after the worker is woken up.

import type { Request } from "../shared/messages";
import { chromeApi } from "./chromeApi";
import { Controller, HEARTBEAT_MS, IDLE_SECONDS } from "./controller";
import { installDevTools } from "./devTools";

const controller = new Controller(chromeApi(() => void controller.refresh()));
const refresh = () => void controller.refresh();

chrome.idle.setDetectionInterval(IDLE_SECONDS);

// Navigations in the main frame (prerendered pages have other frame ids; they're caught by
// tabs.onUpdated when shown).
const onNavigation = (d: { tabId: number; frameId: number; url: string }) => {
  if (d.frameId === 0) void controller.refresh({ tabId: d.tabId, url: d.url });
};
chrome.webNavigation.onBeforeNavigate.addListener(onNavigation);
chrome.webNavigation.onCommitted.addListener(onNavigation); // includes back/forward cache restores
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation); // single-page apps
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) void controller.refresh({ tabId, url: change.url });
});

// What's on screen.
chrome.tabs.onActivated.addListener(refresh);
chrome.windows.onFocusChanged.addListener(refresh);
chrome.idle.onStateChanged.addListener(refresh);

// Timing. The heartbeat also tells sleep apart from use: if it stops, the gap isn't counted.
chrome.alarms.onAlarm.addListener(refresh);
void chrome.alarms.get("heartbeat").then((a) => {
  if (!a) void chrome.alarms.create("heartbeat", { periodInMinutes: HEARTBEAT_MS / 60_000 });
});

chrome.runtime.onInstalled.addListener(refresh);
chrome.runtime.onStartup.addListener(refresh);

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  switch (message.type) {
    case "ping":
      sendResponse({ type: "pong", version: chrome.runtime.getManifest().version });
      return false;
    case "getBlockPage":
      void controller.getBlockPage(message.url).then(sendResponse);
      return true;
    case "continue":
      if (sender.tab?.id === undefined) return false;
      void controller.continueFrom(sender.tab.id).then(sendResponse);
      return true;
    default:
      // Settings actions only from the extension's own pages, never from content scripts.
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
      void controller.action(message).then(sendResponse);
      return true;
  }
  return false;
});

if (__DEV__) installDevTools(controller);

// Worker (re)started: check all open tabs.
refresh();
