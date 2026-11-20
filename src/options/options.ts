// Settings page (Phase 5). For now it just proves the page loads and can talk to the worker.

const status = document.getElementById("status");

chrome.runtime.sendMessage({ type: "ping" }).then(
  (reply: { version?: string } | undefined) => {
    if (status) status.textContent = `Background worker is running (version ${reply?.version ?? "?"}).`;
  },
  (error: unknown) => {
    if (status) status.textContent = `Couldn't reach the background worker: ${String(error)}`;
  },
);
