import { beforeEach, describe, expect, it } from "vitest";
import { Controller, MAX_TICK_MS } from "../../src/background/controller";
import { deserializeState } from "../../src/core/appState";
import { type BlockSet, blockSet, softLimits, website } from "../../src/core/model";
import { MINUTES_PER_DAY, dayWindow } from "../../src/core/schedule";
import { MONDAY, minutes as min, seconds as sec } from "../../src/core/time";
import { allWeek, at } from "../core/helpers";
import { BASE, FakeBrowser } from "./fakeBrowser";

const REDDIT = "https://www.reddit.com/r/all";
const blockOf = (url: string) => `${BASE}#${url}`;

const hard = (windows = allWeek): BlockSet =>
  blockSet({ id: "hard", name: "Bedtime", mode: "hard", targets: [website("reddit.com")], windows, message: "Sleep!" });
const soft = (limits = {}): BlockSet =>
  blockSet({ id: "soft", name: "Night Socials", mode: "soft", targets: [website("reddit.com")], windows: allWeek,
    softLimits: softLimits({ maxOpens: 2, perOpenLimit: min(3), ...limits }) });

describe("Controller", () => {
  let b: FakeBrowser;
  let c: Controller;
  beforeEach(() => {
    b = new FakeBrowser(at("2026-11-16T10:00:00Z")); // Monday
    c = new Controller(b);
  });
  const advance = (ms: number) => { b.time += ms; };
  /** Lets [ms] pass while awake: the heartbeat alarm refreshes every 30 s. */
  const pass = async (ms: number) => {
    for (let left = ms; left > 0; left -= sec(30)) {
      advance(Math.min(sec(30), left));
      await c.refresh();
    }
  };
  const usage = async () => Object.values((await c.getState()).usage);

  // --- 2.1 Navigation ---

  it("redirects a navigation to a hard-blocked site, keeping the URL", async () => {
    await c.addSet(hard());
    b.open(1, "https://example.com/");
    await c.refresh();
    b.navigate(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
    const page = await c.getBlockPage(REDDIT);
    expect(page.status).toBe("blocked");
    expect(page.setName).toBe("Bedtime");
    expect(page.message).toBe("Sleep!");
    expect(page.reasons).toEqual(["Bedtime: blocked until 12:00 AM"]);
  });

  it("uses the navigation URL even before the tab reports it", async () => {
    await c.addSet(hard());
    b.open(1, "https://example.com/");
    await c.refresh({ tabId: 1, url: REDDIT });
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
  });

  it("leaves other sites and non-web pages alone", async () => {
    await c.addSet(hard());
    b.open(1, "https://example.com/");
    b.open(2, "chrome://extensions/");
    await c.refresh();
    expect(b.updates).toEqual([]);
  });

  // --- 2.2 Already-open tabs ---

  it("redirects every open tab when a hard window starts, and sends them back when it ends", async () => {
    await c.addSet(hard([dayWindow(MONDAY, 11 * 60, 12 * 60)]));
    b.open(1, REDDIT);
    b.open(2, "https://old.reddit.com/", 2);
    b.open(3, "https://example.com/");
    await c.refresh();
    expect(b.updates).toEqual([]);
    expect(b.tickAt).toBe(b.time + MAX_TICK_MS); // capped; next change is in an hour
    b.time = at("2026-11-16T11:00:00Z");
    await c.refresh();
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
    expect(b.urlOf(2)).toBe(blockOf("https://old.reddit.com/"));
    expect(b.urlOf(3)).toBe("https://example.com/");
    expect(b.rules).toEqual(["reddit.com"]);
    b.time = at("2026-11-16T12:00:00Z");
    await c.refresh();
    expect(b.urlOf(1)).toBe(REDDIT);
    expect(b.urlOf(2)).toBe("https://old.reddit.com/");
    expect(b.rules).toEqual([]);
  });

  it("catches single-page-app URL changes", async () => {
    await c.addSet(blockSet({ ...hard(), targets: [website("youtube.com")] }));
    b.open(1, "https://www.google.com/");
    await c.refresh();
    b.navigate(1, "https://www.youtube.com/shorts/x");
    await c.refresh({ tabId: 1, url: "https://www.youtube.com/shorts/x" });
    expect(b.urlOf(1)).toBe(blockOf("https://www.youtube.com/shorts/x"));
  });

  // --- Soft gate and Continue ---

  it("soft gate: Continue returns to the site and starts an open", async () => {
    await c.addSet(soft({ unlockDelay: sec(10) }));
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
    const page = await c.getBlockPage(REDDIT);
    expect(page.status).toBe("softGate");
    expect(page.soft).toMatchObject({ unlockDelay: sec(10), opensUsed: 0, maxOpens: 2, limitsSummary: "3 min per open" });
    expect(await c.continueFrom(1)).toEqual({ ok: true });
    expect(b.urlOf(1)).toBe(REDDIT);
    expect((await usage())[0]!.opensUsed).toBe(1);
  });

  it("time on the block page doesn't count; time on the site does, and the open ends on time", async () => {
    await c.addSet(soft());
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    await pass(min(5)); // on the block page
    await c.continueFrom(1);
    expect(b.tickAt).toBe(b.time + MAX_TICK_MS); // limit is 3 min away; capped
    await pass(min(3));
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
    expect((await usage())[0]!.timeUsed).toBe(min(3));
  });

  it("Continue only works from the tab in use", async () => {
    await c.addSet(soft());
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    b.open(2, "https://example.com/");
    await c.refresh();
    expect((await c.continueFrom(1)).ok).toBe(false);
  });

  it("background tabs on a soft site are left alone until you switch to them", async () => {
    await c.addSet(soft());
    b.open(1, REDDIT);
    b.open(2, "https://example.com/");
    await c.refresh();
    expect(b.urlOf(1)).toBe(REDDIT);
    b.activate(1);
    await c.refresh();
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
  });

  it("a background tab navigating to a soft site is gated", async () => {
    await c.addSet(soft());
    b.open(1, "https://example.com/");
    b.tabs.push({ id: 2, windowId: 1, url: REDDIT, active: false, audible: false });
    await c.refresh({ tabId: 2, url: REDDIT });
    expect(b.urlOf(2)).toBe(blockOf(REDDIT));
  });

  it("other block pages for the site go back once an open starts", async () => {
    await c.addSet(soft());
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    b.open(2, "https://www.reddit.com/r/b");
    await c.refresh({ tabId: 2, url: "https://www.reddit.com/r/b" });
    expect(b.urlOf(2)).toBe(blockOf("https://www.reddit.com/r/b"));
    b.activate(1);
    await c.refresh();
    await c.continueFrom(1);
    expect(b.urlOf(1)).toBe(REDDIT);
    expect(b.urlOf(2)).toBe("https://www.reddit.com/r/b");
  });

  it("used-up soft site gets the fast-path rule", async () => {
    await c.addSet(soft({ maxOpens: 1, perOpenLimit: min(1) }));
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    await c.continueFrom(1);
    expect(b.rules).toEqual([]);
    advance(min(1));
    await c.refresh();
    expect(b.rules).toEqual(["reddit.com"]);
    expect((await c.getBlockPage(REDDIT)).reasons).toEqual(["Night Socials: all 1 opens used"]);
  });

  // --- 2.3 / 2.4 Time tracking ---

  async function openSession(limits = {}) {
    await c.addSet(soft({ perOpenLimit: null, totalLimit: min(30), graceTime: sec(15), ...limits }));
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    await c.continueFrom(1);
  }

  it("doesn't count while another app has focus", async () => {
    await openSession();
    await pass(min(2));
    b.focused = null;
    await c.refresh();
    await pass(min(10));
    b.focused = 1;
    await c.refresh();
    expect((await usage())[0]!.timeUsed).toBe(min(2));
  });

  it("grace period: switching tabs briefly keeps the open, longer needs a new one", async () => {
    await openSession();
    b.open(2, "https://example.com/");
    await c.refresh();
    advance(sec(10));
    b.activate(1);
    await c.refresh();
    expect(b.urlOf(1)).toBe(REDDIT);
    b.activate(2);
    await c.refresh();
    advance(sec(20));
    b.activate(1);
    await c.refresh();
    expect(b.urlOf(1)).toBe(blockOf(REDDIT));
  });

  it("two tabs of the same site share the open", async () => {
    await openSession();
    b.open(2, "https://www.reddit.com/r/b");
    await c.refresh({ tabId: 2, url: "https://www.reddit.com/r/b" });
    expect(b.urlOf(2)).toBe("https://www.reddit.com/r/b");
    expect((await usage())[0]!.opensUsed).toBe(1);
  });

  it("idle without audio and locked screens don't count; idle with audio does", async () => {
    await openSession({ graceTime: min(60) });
    await pass(min(1));
    b.idle = "idle";
    await c.refresh(); // idle.onStateChanged
    await pass(min(5));
    b.idle = "active";
    await c.refresh();
    expect((await usage())[0]!.timeUsed).toBe(min(1));
    b.tabs = b.tabs.map((t) => ({ ...t, audible: true }));
    b.idle = "idle";
    await c.refresh();
    await pass(min(5));
    expect((await usage())[0]!.timeUsed).toBe(min(6));
    b.idle = "locked";
    await c.refresh();
    await pass(min(5));
    expect((await usage())[0]!.timeUsed).toBe(min(6));
  });

  it("a gap with no heartbeat (sleep) isn't counted", async () => {
    await openSession({ graceTime: min(60) });
    for (let i = 0; i < 4; i++) {
      advance(sec(30));
      await c.refresh(); // heartbeats
    }
    advance(min(45)); // asleep: nothing ran
    await c.refresh();
    expect((await usage())[0]!.timeUsed).toBe(min(2));
  });

  // --- Warnings / reminders ---

  it("sends the time warning banner to the tab in use", async () => {
    await openSession({ totalLimit: min(15) });
    await pass(min(4) + sec(30));
    expect(b.tickAt).toBe(b.time + sec(30) + 50); // the 10-minute warning
    await pass(sec(30));
    expect(b.sent).toEqual([{ tabId: 1, message: { type: "banner", text: "www.reddit.com · 10 minutes left", setName: "Night Socials", color: "#5c6bc0" } }]);
  });

  it("sends reminders for reminder sets", async () => {
    await c.addSet(blockSet({ id: "r", name: "Awareness", mode: "reminder", targets: [website("reddit.com")], windows: allWeek,
      softLimits: softLimits({ reminderInterval: min(1) }) }));
    b.open(1, REDDIT);
    await c.refresh({ tabId: 1, url: REDDIT });
    advance(min(1));
    await c.refresh();
    expect(b.sent.map((s) => s.message.text)).toEqual(["www.reddit.com · 1 minute so far"]);
    expect(b.urlOf(1)).toBe(REDDIT);
  });

  // --- 2.5 / 2.6 Scheduling and persistence ---

  it("persists state and resumes after a worker restart", async () => {
    await openSession();
    advance(min(1));
    await c.refresh();
    const stored = deserializeState(b.storage.state);
    expect(stored.sets).toHaveLength(1);
    // New worker, same storage.
    const c2 = new Controller(b);
    advance(sec(30));
    await c2.refresh();
    const u = Object.values((await c2.getState()).usage)[0]!;
    expect(u.timeUsed).toBe(min(1) + sec(30));
    expect(b.urlOf(1)).toBe(REDDIT); // the open survived
  });

  it("keeps unreadable state instead of overwriting it", async () => {
    b.storage.state = { version: 99 };
    await c.refresh();
    expect(Object.keys(b.storage).some((k) => k.startsWith("state-unreadable-"))).toBe(true);
  });

  it("schedules the window boundary when no limit is sooner", async () => {
    b.time = at("2026-11-16T10:00:30Z");
    await c.addSet(hard([dayWindow(MONDAY, 10 * 60 + 1, MINUTES_PER_DAY)]));
    await c.refresh();
    expect(b.tickAt).toBe(at("2026-11-16T10:01:00Z") + 50);
  });
});
