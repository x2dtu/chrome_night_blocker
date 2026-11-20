import { describe, expect, it } from "vitest";
import { BlockEngine } from "../../src/core/engine";
import { type BlockSet, type LimitScope, type SoftLimits, WHOLE_SET, blockSet, softLimits, website } from "../../src/core/model";
import { UTC, minutes as min } from "../../src/core/time";
import { allWeek, at } from "./helpers";

describe("time warnings", () => {
  const start = at("2026-11-16T10:00:00Z");
  const site = "a.com";

  function setup(limits: Partial<SoftLimits>) {
    const e = new BlockEngine(UTC, [blockSet({ id: "s", name: "Night Socials", mode: "soft", targets: [website("a.com")], windows: allWeek, softLimits: softLimits(limits) })]);
    e.onForegroundChanged(site, start);
    e.unlock(start);
    const advanceTo = (m: number) => {
      e.tick(start + min(m));
      return e.collectTimeWarnings(start + min(m)).map((w) => w.threshold);
    };
    return { e, advanceTo };
  }

  it("warns at 10 and 1 minutes left, once each", () => {
    const { e, advanceTo } = setup({ totalLimit: min(30) });
    expect(e.collectTimeWarnings(start)).toEqual([]);
    expect(e.nextEvaluationAt(start)).toBe(at("2026-11-16T10:20:00Z"));
    expect(advanceTo(19)).toEqual([]);
    expect(advanceTo(20)).toEqual([min(10)]);
    expect(advanceTo(21)).toEqual([]);
    expect(e.nextEvaluationAt(start + min(21))).toBe(at("2026-11-16T10:29:00Z"));
    expect(advanceTo(29)).toEqual([min(1)]);
    expect(advanceTo(29)).toEqual([]);
  });

  it("no 10-minute warning when the whole limit is shorter", () => {
    const { e, advanceTo } = setup({ totalLimit: min(5) });
    expect(e.collectTimeWarnings(start)).toEqual([]);
    expect(advanceTo(4)).toEqual([min(1)]);
  });

  it("jumping past both marks sends only the urgent one", () => {
    const { advanceTo } = setup({ totalLimit: min(30) });
    expect(advanceTo(29)).toEqual([min(1)]); // e.g. a late alarm
    expect(advanceTo(29)).toEqual([]);
  });

  it("off when disabled, no total limit, or not on screen", () => {
    expect(setup({ totalLimit: min(30), timeWarnings: false }).advanceTo(25)).toEqual([]);
    expect(setup({ perOpenLimit: min(30) }).advanceTo(25)).toEqual([]);
    const { e, advanceTo } = setup({ totalLimit: min(30) });
    advanceTo(15);
    e.onForegroundChanged(null, start + min(15));
    expect(e.collectTimeWarnings(start + min(25))).toEqual([]);
  });
});

describe("usage reminders", () => {
  const start = at("2026-11-16T10:00:00Z");
  const insta = "www.instagram.com";
  const tiktok = "www.tiktok.com";

  const reminderSet = (scope: LimitScope = "eachSite", interval: number | null = min(15)): BlockSet => blockSet({
    id: "r", name: "Awareness", mode: "reminder",
    targets: [website("instagram.com"), website("tiktok.com")], windows: allWeek,
    softLimits: softLimits({ reminderInterval: interval }), limitScope: scope,
  });

  function setup(...sets: BlockSet[]) {
    const e = new BlockEngine(UTC, sets);
    let now = start;
    const atMin = (m: number) => {
      now = start + min(m);
      e.tick(now);
      return e.collectReminders(now).map((r) => r.used);
    };
    return { e, atMin, now: () => now };
  }

  it("reminder sets never block and remind every interval", () => {
    const { e, atMin } = setup(reminderSet());
    expect(e.onForegroundChanged(insta, start).type).toBe("allow");
    expect(e.nextEvaluationAt(start)).toBe(start + min(15));
    expect(atMin(14)).toEqual([]);
    expect(atMin(15)).toEqual([min(15)]);
    expect(atMin(20)).toEqual([]);
    expect(atMin(30)).toEqual([min(30)]);
  });

  it("reminder interval falls back to the default", () => {
    const { e, atMin } = setup(reminderSet("eachSite", null));
    e.onForegroundChanged(insta, start);
    expect(atMin(15)).toEqual([min(15)]);
  });

  it("time only counts while on screen, per site by default", () => {
    const { e, atMin, now } = setup(reminderSet());
    e.onForegroundChanged(insta, start);
    atMin(10);
    e.onForegroundChanged(null, now());
    atMin(60);
    e.onForegroundChanged(tiktok, now());
    expect(atMin(70)).toEqual([]); // TikTok has its own 10 min
    e.onForegroundChanged(insta, now());
    expect(atMin(75)).toEqual([min(15)]); // Instagram: 10 + 5
  });

  it("shared scope adds all sites together", () => {
    const { e, atMin, now } = setup(reminderSet("wholeSet"));
    e.onForegroundChanged(insta, start);
    atMin(10);
    e.onForegroundChanged(tiktok, now());
    e.tick(start + min(15));
    const r = e.collectReminders(start + min(15));
    expect(r).toHaveLength(1);
    expect(r[0]!.used).toBe(min(15));
    expect(r[0]!.target).toEqual(WHOLE_SET);
  });

  it("soft sets can remind during an open, not on the block page", () => {
    const soft = blockSet({ id: "s", name: "Night Socials", mode: "soft", targets: [website("instagram.com")], windows: allWeek,
      softLimits: softLimits({ reminderInterval: min(5) }) });
    const { e, atMin, now } = setup(soft);
    e.onForegroundChanged(insta, start);
    expect(atMin(10)).toEqual([]); // sitting on the block page doesn't count
    e.unlock(now());
    expect(atMin(15)).toEqual([min(5)]);
  });

  it("reminders don't change another set's block", () => {
    const hard = blockSet({ id: "h", name: "Bedtime", mode: "hard", targets: [website("instagram.com")], windows: allWeek });
    const { e, atMin } = setup(reminderSet(), hard);
    expect(e.onForegroundChanged(insta, start).type).toBe("blocked");
    expect(atMin(30)).toEqual([]); // blocked time isn't usage
  });
});
