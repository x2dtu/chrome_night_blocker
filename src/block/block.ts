// The block page. The blocked URL is after "#"; the worker says what to show.

import { hostFromUrl } from "../core/hosts";
import type { BlockPageModel, ContinueResult, Request } from "../shared/messages";
import { chipText, continueLabel, openDots, resetKey, softStats, streakText } from "./view";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const continueButton = $<HTMLButtonElement>("continue");

let model: BlockPageModel | null = null;
let shownKey = "";
let deadline = 0;
let countdown: ReturnType<typeof setInterval> | undefined;

const originalUrl = () => location.hash.slice(1);

async function load(): Promise<void> {
  const url = originalUrl();
  const host = hostFromUrl(url) ?? "This site";
  $("site").textContent = host;
  document.title = `${host} · Blocked`;
  const favicon = $<HTMLImageElement>("favicon");
  const src = `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`;
  if (favicon.getAttribute("src") !== src) favicon.src = src;
  try {
    const request: Request = { type: "getBlockPage", url };
    model = (await chrome.runtime.sendMessage(request)) as BlockPageModel;
  } catch (e) {
    $("error").textContent = `Couldn't reach Night Blocker: ${String(e)}`;
    return;
  }
  render(model);
}

function render(m: BlockPageModel): void {
  document.documentElement.style.setProperty("--accent", m.color);
  const allowed = m.status === "allowed";
  $("returning").hidden = !allowed;
  $("chip").parentElement!.hidden = allowed;

  $("chip").textContent = chipText(m);
  show("message", m.message.trim() ? `“${m.message.trim()}”` : "");
  show("streak", streakText(m.streakDays));
  $("why").hidden = m.reasons.length === 0;
  $("reasons").replaceChildren(...m.reasons.map((r) => Object.assign(document.createElement("li"), { textContent: r })));

  $("hard-controls").hidden = m.status !== "blocked";
  $("soft-controls").hidden = m.status !== "softGate";
  const soft = m.soft;
  if (m.status === "softGate" && soft) {
    $("dots").replaceChildren(...(soft.maxOpens === null ? [] : openDots(soft.opensUsed, soft.maxOpens).map((state) =>
      Object.assign(document.createElement("span"), { className: state }))));
    show("stats", softStats(soft));
    show("limits", soft.limitsSummary);
    const key = resetKey(m);
    if (key !== shownKey) startCountdown(soft.unlockDelay);
    shownKey = key;
  } else {
    shownKey = resetKey(m);
  }
}

function show(id: string, text: string): void {
  $(id).textContent = text;
  $(id).hidden = text === "";
}

/** Counts down to a fixed deadline (not 1 per tick), so a busy page can't make the unlock late. */
function startCountdown(delay: number): void {
  clearInterval(countdown);
  deadline = performance.now() + delay;
  const step = () => {
    const secondsLeft = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    continueButton.disabled = secondsLeft > 0;
    continueButton.textContent = continueLabel(secondsLeft);
    if (secondsLeft === 0) clearInterval(countdown);
  };
  step();
  countdown = setInterval(step, 200);
}

continueButton.addEventListener("click", async () => {
  continueButton.disabled = true;
  $("error").textContent = "";
  const request: Request = { type: "continue" };
  const result = (await chrome.runtime.sendMessage(request)) as ContinueResult;
  if (!result.ok) {
    $("error").textContent = `Couldn't continue: ${result.reason ?? "unknown error"}`;
    shownKey = ""; // restart the countdown
    void load();
  }
});

// Leaving opens the new tab page in this tab rather than closing it.
const leave = () => void chrome.tabs.update({ url: "chrome://newtab/" });
$("leave").addEventListener("click", leave);
$("leave-primary").addEventListener("click", leave);

// The unlock delay restarts if you leave the page and come back.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    shownKey = "";
    void load();
  }
});
window.addEventListener("hashchange", () => {
  shownKey = "";
  void load();
});
// Keep the numbers fresh (a window ending, time running out, limits edited).
setInterval(() => void load(), 5000);

void load();
