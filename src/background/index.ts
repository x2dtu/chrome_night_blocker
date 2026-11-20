// Background service worker. MV3 workers are stopped when idle, so all state must live in
// chrome.storage and all timing in chrome.alarms (Phase 2). Listeners must be registered
// synchronously at the top level so they fire after the worker is woken up.

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[Night Blocker] installed (${details.reason}), version ${chrome.runtime.getManifest().version}`);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Night Blocker] browser started");
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isPing(message)) {
    sendResponse({ type: "pong", version: chrome.runtime.getManifest().version });
  }
  return false;
});

function isPing(message: unknown): message is { type: "ping" } {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "ping";
}
