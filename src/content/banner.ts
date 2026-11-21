// Content script: the warning / reminder banner at the top of the page ("reddit.com · 10 minutes
// left", block set name underneath, a stripe in the set's color). Lives in a closed shadow root
// so the site's CSS can't touch it. Click it, or drag it sideways or up, to dismiss; otherwise it
// fades after ~4.5 s.

import type { ContentMessage } from "../shared/messages";
import { DISMISS_FRACTION, FADE_IN_MS, FADE_OUT_MS, SHOW_MS, badgeLetter, dragEnd } from "./bannerLogic";

const STYLE = `
  :host { all: initial; }
  .wrap {
    position: fixed; top: 12px; left: 50%; z-index: 2147483647;
    width: min(440px, calc(100vw - 24px));
    transform: translateX(-50%);
    font: 15px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    pointer-events: none;
  }
  .card {
    pointer-events: auto; cursor: pointer; user-select: none; touch-action: none;
    display: flex; align-items: center; gap: 14px;
    padding: 14px 18px 14px 14px; border-radius: 22px;
    background: rgb(21 25 41 / 95%); color: #fff;
    box-shadow: 0 8px 28px rgb(0 0 0 / 35%);
    opacity: 0; transition: opacity ${FADE_IN_MS}ms ease-out;
  }
  .card.visible { opacity: 1; }
  .card.leaving { opacity: 0; transition: opacity ${FADE_OUT_MS}ms ease-in; }
  .card.dragging { transition: none; }
  .stripe { flex: none; width: 5px; height: 42px; border-radius: 3px; background: var(--accent); }
  .badge {
    flex: none; width: 40px; height: 40px; border-radius: 50%;
    display: grid; place-items: center;
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    font-size: 19px; font-weight: 600;
  }
  .text { min-width: 0; }
  .title { font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
  .subtitle { color: #b4b9d2; font-size: 14px; }
  @media (prefers-reduced-motion: reduce) { .card, .card.leaving { transition: none; } }
`;

let current: { host: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

function show(message: ContentMessage): void {
  remove();
  const host = document.createElement("night-blocker-banner");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;

  const wrap = el("div", "wrap");
  const card = el("div", "card");
  card.style.setProperty("--accent", message.color);
  card.setAttribute("role", "status");
  card.title = "Click to dismiss";
  const text = el("div", "text");
  text.append(el("div", "title", message.text), el("div", "subtitle", message.setName));
  card.append(el("div", "stripe"), el("div", "badge", badgeLetter(location.hostname)), text);
  wrap.append(card);
  root.append(style, wrap);

  // In fullscreen (e.g. a video player), only the fullscreen element's subtree is visible.
  const fs = document.fullscreenElement;
  (fs && !(fs instanceof HTMLVideoElement) ? fs : document.documentElement).append(host);
  requestAnimationFrame(() => card.classList.add("visible"));

  let dragging = false;
  let dueWhileDragging = false;
  const timer = setTimeout(() => (dragging ? (dueWhileDragging = true) : fadeOut()), SHOW_MS);
  current = { host, timer };

  const fadeOut = () => {
    card.classList.add("leaving");
    setTimeout(() => remove(host), FADE_OUT_MS);
  };

  let startX = 0;
  let startY = 0;
  card.addEventListener("pointerdown", (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = Math.min(0, e.clientY - startY); // only upwards
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    card.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / (card.offsetWidth * DISMISS_FRACTION * 2)));
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    const result = dragEnd(e.clientX - startX, e.clientY - startY, card.offsetWidth, dueWhileDragging);
    if (result === "dismiss") return remove(host);
    card.style.transform = "";
    card.style.opacity = "";
    if (result === "fadeOut") fadeOut();
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

/** Removes [host] (or whatever banner is showing). */
function remove(host?: HTMLElement): void {
  if (!current || (host && current.host !== host)) return;
  clearTimeout(current.timer);
  current.host.remove();
  current = null;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

chrome.runtime.onMessage.addListener((message: ContentMessage) => {
  if (message.type === "banner") show(message);
  return false;
});
