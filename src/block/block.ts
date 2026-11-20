// Block page (Phase 3). Blocked tabs are redirected to block.html?url=<original URL>
// so a soft-block "Continue" can return to where the user was going.

const params = new URLSearchParams(location.search);
const original = params.get("url");

const site = document.getElementById("site");
if (site) site.textContent = original ? hostOf(original) : "This site";

document.getElementById("new-tab")?.addEventListener("click", () => {
  // Leaving a blocked site opens a new tab rather than closing the user's tab.
  void chrome.tabs.update({ url: "chrome://newtab" });
});

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
