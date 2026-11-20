// Content script (Phase 4 draws the warning / reminder banner in a shadow root).
// For now it only listens, so the background worker can already target it.

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "banner") {
    console.debug("[Night Blocker] banner requested", message);
  }
  return false;
});
