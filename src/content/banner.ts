// Content script. Phase 4 draws the warning / reminder banner in a shadow root; for now it logs.

import type { ContentMessage } from "../shared/messages";

chrome.runtime.onMessage.addListener((message: ContentMessage) => {
  if (message.type === "banner") {
    console.info(`[Night Blocker] ${message.text} (${message.setName})`);
  }
  return false;
});
