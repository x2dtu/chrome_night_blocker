// Block page (functional version; Phase 3 does the real design). The blocked URL is after "#".

import { hostFromUrl } from "../core/hosts";
import { softStatusLine } from "../background/presentation";
import type { BlockPageModel, ContinueResult, Request } from "../shared/messages";

const $ = (id: string) => document.getElementById(id)!;
const continueButton = $("continue") as HTMLButtonElement;

let model: BlockPageModel | null = null;
let unlockAt = 0;
let countdown: ReturnType<typeof setInterval> | undefined;

function originalUrl(): string {
  return location.hash.slice(1);
}

async function load(): Promise<void> {
  const url = originalUrl();
  $("site").textContent = hostFromUrl(url) ?? "This site";
  const request: Request = { type: "getBlockPage", url };
  model = (await chrome.runtime.sendMessage(request)) as BlockPageModel;
  render();
}

function render(): void {
  if (!model) return;
  document.body.style.setProperty("--set-color", model.color);
  $("headline").textContent = model.status === "softGate" ? "is limited right now." : model.status === "blocked" ? "is blocked right now." : "is allowed again…";
  $("set-name").textContent = model.setName;
  $("message").textContent = model.message;
  $("streak").textContent = model.streakDays > 0 ? `🔥 ${model.streakDays}-day streak` : "";
  $("reasons").replaceChildren(...model.reasons.map((r) => Object.assign(document.createElement("li"), { textContent: r })));
  const soft = model.soft;
  $("soft").hidden = soft === null;
  if (soft) {
    $("soft-status").textContent = softStatusLine(soft);
    $("soft-limits").textContent = soft.limitsSummary;
    if (countdown === undefined) startCountdown(soft.unlockDelay);
  }
}

/** The unlock delay restarts whenever the page is shown again. */
function startCountdown(delay: number): void {
  clearInterval(countdown);
  unlockAt = Date.now() + delay;
  const step = () => {
    const left = unlockAt - Date.now();
    continueButton.disabled = left > 0;
    continueButton.textContent = left > 0 ? `Continue in ${Math.ceil(left / 1000)} s` : "Continue";
    if (left <= 0) clearInterval(countdown);
  };
  step();
  countdown = setInterval(step, 250);
}

continueButton.addEventListener("click", async () => {
  continueButton.disabled = true;
  const request: Request = { type: "continue" };
  const result = (await chrome.runtime.sendMessage(request)) as ContinueResult;
  if (!result.ok) {
    $("error").textContent = `Couldn't continue: ${result.reason ?? "unknown"}`;
    void load();
  }
});

$("new-tab").addEventListener("click", () => {
  // Leaving a blocked site opens a new tab page rather than closing the user's tab.
  void chrome.tabs.update({ url: "chrome://newtab/" });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    clearInterval(countdown);
    countdown = undefined;
    void load();
  }
});
window.addEventListener("hashchange", () => void load());
// Keep the numbers fresh (e.g. a window ending, or limits changing).
setInterval(() => void load(), 5000);

void load();
