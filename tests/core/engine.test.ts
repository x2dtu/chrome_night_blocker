import { beforeEach, describe, expect, it } from "vitest";
import { type Decision, describeBlocker, formatDuration, gateTimeLeft } from "../../src/core/decision";
import { BlockEngine } from "../../src/core/engine";
import { type BlockSet, type SoftLimits, type Target, WHOLE_SET, blockSet, softLimits, website } from "../../src/core/model";
import { MINUTES_PER_DAY, dayWindow } from "../../src/core/schedule";
import { MONDAY, TUESDAY, UTC, minutes as min, parseLocal, seconds as sec } from "../../src/core/time";
import { allWeek, at } from "./helpers";

function blocked(d: Decision) {
  if (d.type !== "blocked") throw new Error(`expected blocked, got ${d.type}`);
  return d;
}
function gate(d: Decision) {
  if (d.type !== "softGate") throw new Error(`expected softGate, got ${d.type}`);
  return d;
}

describe("BlockEngine", () => {
  // Monday 2026-11-16, UTC.
  let now = at("2026-11-16T10:00:00Z");
  beforeEach(() => { now = at("2026-11-16T10:00:00Z"); });
  const advance = (d: number) => { now += d; };

  const allMonday = [dayWindow(MONDAY, 0, MINUTES_PER_DAY)];
  const mondayAndTuesday = [dayWindow(MONDAY, 0, MINUTES_PER_DAY - 60), dayWindow(TUESDAY, 0, MINUTES_PER_DAY)];

  const siteA = website("a.com");
  const siteB = website("b.com");
  const fgA = "a.com";
  const fgB = "b.com";
  const other = "other.org";

  const soft = (limits: Partial<SoftLimits>, id = "soft", targets: Target[] = [siteA], windows = allMonday): BlockSet =>
    blockSet({ id, name: "Night Socials", mode: "soft", targets, windows, softLimits: softLimits(limits) });
  const hard = (id = "hard", targets: Target[] = [siteA]): BlockSet =>
    blockSet({ id, name: "Bedtime", mode: "hard", targets, windows: allMonday });
  const engine = (...sets: BlockSet[]) => new BlockEngine(UTC, sets);
  const usage = (e: BlockEngine) => Object.values(e.usage);

  // --- Hard blocks ---

  it("no sets allows everything", () => {
    expect(engine().onForegroundChanged(fgA, now)).toEqual({ type: "allow" });
  });

  it("hard block inside window", () => {
    const d = blocked(engine(hard()).onForegroundChanged(fgA, now));
    expect(d.blockers[0]!.reason).toEqual({ type: "scheduled" });
    expect(d.blockers[0]!.until).toBe(parseLocal("2026-11-17T00:00"));
    expect(describeBlocker(d.blockers[0]!)).toBe("Bedtime: blocked until 12:00 AM");
  });

  it("hard block outside window allows", () => {
    now = at("2026-11-17T10:00:00Z");
    expect(engine(hard()).onForegroundChanged(fgA, now).type).toBe("allow");
  });

  it("other sites are not affected", () => {
    expect(engine(hard()).onForegroundChanged(fgB, now).type).toBe("allow");
  });

  // --- Soft blocks: gate and opens ---

  it("soft block shows gate with delay and open count", () => {
    const d = gate(engine(soft({ unlockDelay: sec(10), maxOpens: 4 })).onForegroundChanged(fgA, now));
    expect(d.unlockDelay).toBe(sec(10));
    expect(d.opens).toEqual({ used: 0, max: 4 });
  });

  it("soft block without limits still gates then allows unlimited", () => {
    const e = engine(soft({}));
    expect(e.onForegroundChanged(fgA, now).type).toBe("softGate");
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: null });
  });

  it("per-open limit ends the open and re-gates", () => {
    const e = engine(soft({ maxOpens: 4, perOpenLimit: min(3) }));
    e.onForegroundChanged(fgA, now);
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: min(3) });
    advance(min(3));
    expect(gate(e.tick(now)).opens).toEqual({ used: 1, max: 4 });
  });

  it("each open starts fresh at the per-open limit", () => {
    const e = engine(soft({ perOpenLimit: min(3) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(1));
    e.onForegroundChanged(other, now);
    advance(min(5)); // well past grace
    expect(e.onForegroundChanged(fgA, now).type).toBe("softGate");
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: min(3) });
  });

  it("opens exhausted becomes a hard block with reason", () => {
    const e = engine(soft({ maxOpens: 2, perOpenLimit: min(1) }));
    e.onForegroundChanged(fgA, now);
    for (let i = 0; i < 2; i++) {
      e.unlock(now);
      advance(min(1));
      e.tick(now);
    }
    const d = blocked(e.tick(now));
    expect(d.blockers[0]!.reason).toEqual({ type: "opensExhausted", maxOpens: 2 });
    expect(describeBlocker(d.blockers[0]!)).toBe("Night Socials: all 2 opens used");
  });

  // --- Grace period ---

  it("returning within grace continues the open without counting time away", () => {
    const e = engine(soft({ maxOpens: 4, perOpenLimit: min(3), graceTime: sec(15) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(1));
    e.onForegroundChanged(other, now);
    advance(sec(10));
    expect(e.onForegroundChanged(fgA, now)).toEqual({ type: "inSession", remaining: min(2) });
    expect(usage(e)[0]!.opensUsed).toBe(1);
  });

  it("returning after grace needs a new open", () => {
    const e = engine(soft({ maxOpens: 4, graceTime: sec(15) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    e.onForegroundChanged(other, now);
    advance(sec(16));
    expect(gate(e.onForegroundChanged(fgA, now)).opens).toEqual({ used: 1, max: 4 });
  });

  it("grace time is configurable", () => {
    const e = engine(soft({ graceTime: min(2) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    e.onForegroundChanged(other, now);
    advance(sec(90));
    expect(e.onForegroundChanged(fgA, now).type).toBe("inSession");
  });

  // --- Total time limit ---

  it("total limit cuts the last open short", () => {
    // 3 opens x 5 min, 12 min total.
    const e = engine(soft({ maxOpens: 3, perOpenLimit: min(5), totalLimit: min(12) }));
    e.onForegroundChanged(fgA, now);
    for (let i = 0; i < 2; i++) {
      e.unlock(now);
      advance(min(5));
      e.tick(now);
    }
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: min(2) });
    advance(min(2));
    const d = blocked(e.tick(now));
    expect(d.blockers[0]!.reason).toEqual({ type: "totalTimeExceeded", limit: min(12) });
    expect(describeBlocker(d.blockers[0]!)).toBe("Night Socials: screen time exceeded 12 min");
  });

  it("gate reports total time left", () => {
    const e = engine(soft({ totalLimit: min(12) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(4));
    e.onForegroundChanged(other, now);
    advance(min(5));
    const g = gate(e.onForegroundChanged(fgA, now)).gates[0]!;
    expect(gateTimeLeft(g)).toBe(min(8));
    expect(g.totalLimit).toBe(min(12));
  });

  it("time on the block page and with nothing on screen does not count", () => {
    const e = engine(soft({ totalLimit: min(10) }));
    e.onForegroundChanged(fgA, now);
    advance(min(30)); // sitting on the gate
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: min(10) });
    advance(min(1));
    e.onForegroundChanged(null, now); // idle / browser in background
    advance(min(30));
    e.onForegroundChanged(fgA, now);
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: min(9) });
  });

  // --- Per-target independence and resets ---

  it("sites in a set are limited independently", () => {
    const e = engine(soft({ maxOpens: 1, perOpenLimit: min(1) }, "soft", [siteA, siteB]));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(1));
    expect(e.tick(now).type).toBe("blocked");
    expect(gate(e.onForegroundChanged(fgB, now)).opens).toEqual({ used: 0, max: 1 });
  });

  it("usage resets on the next window occurrence", () => {
    const e = engine(soft({ maxOpens: 1, perOpenLimit: min(1) }, "soft", [siteA], mondayAndTuesday));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(1));
    expect(e.tick(now).type).toBe("blocked");
    // Monday's window ends at 23:00; Tuesday's starts at 00:00.
    now = at("2026-11-16T23:30:00Z");
    expect(e.tick(now).type).toBe("allow");
    now = at("2026-11-17T00:00:00Z");
    expect(gate(e.tick(now)).opens).toEqual({ used: 0, max: 1 });
  });

  it("window ending mid-session allows", () => {
    now = at("2026-11-16T23:59:00Z");
    const e = engine(soft({ perOpenLimit: min(5) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(1));
    expect(e.tick(now).type).toBe("allow");
  });

  // --- Most restrictive wins ---

  it("hard beats soft and names the set", () => {
    const d = blocked(engine(soft({}), hard()).onForegroundChanged(fgA, now));
    expect(d.blockers[0]!.setName).toBe("Bedtime");
  });

  it("exhausted soft set beats another set's open session", () => {
    const e = engine(soft({ totalLimit: min(1) }, "strict"), soft({}, "loose"));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(1));
    expect(blocked(e.tick(now)).blockers[0]!.setId).toBe("strict");
  });

  it("two soft sets both gate, unlock uses one open from each", () => {
    const e = engine(soft({ maxOpens: 5, unlockDelay: sec(5) }, "a"), soft({ maxOpens: 2, unlockDelay: sec(30) }, "b"));
    const g = gate(e.onForegroundChanged(fgA, now));
    expect(g.unlockDelay).toBe(sec(30));
    expect(g.opens).toEqual({ used: 0, max: 2 }); // most constrained
    expect(g.gates[0]!.setId).toBe("b");
    e.unlock(now);
    expect(usage(e).map((u) => u.opensUsed)).toEqual([1, 1]);
  });

  it("usage counts against every matching soft set", () => {
    const e = engine(soft({ totalLimit: min(10) }, "a"), soft({ totalLimit: min(4) }, "b"));
    e.onForegroundChanged(fgA, now);
    expect(e.unlock(now)).toEqual({ type: "inSession", remaining: min(4) });
    advance(min(4));
    expect(blocked(e.tick(now)).blockers[0]!.setId).toBe("b");
    expect(usage(e).map((u) => u.timeUsed)).toEqual([min(4), min(4)]);
  });

  // --- Pause / disabled ---

  it("paused and disabled sets are ignored", () => {
    const e = engine({ ...hard(), suspendedUntil: now + min(1) });
    expect(e.onForegroundChanged(fgA, now).type).toBe("allow");
    advance(min(1));
    expect(e.tick(now).type).toBe("blocked");
    expect(engine({ ...hard(), enabled: false }).onForegroundChanged(fgA, now).type).toBe("allow");
  });

  // --- Websites ---

  it("website target matches domain and subdomains only", () => {
    const e = engine(hard("hard", [website("reddit.com")]));
    expect(e.onForegroundChanged("reddit.com", now).type).toBe("blocked");
    expect(e.onForegroundChanged("old.reddit.com", now).type).toBe("blocked");
    expect(e.onForegroundChanged("notreddit.com", now).type).toBe("allow");
    expect(e.onForegroundChanged("google.com", now).type).toBe("allow");
  });

  it("subdomains share one website's usage", () => {
    const e = engine(soft({ maxOpens: 3 }, "soft", [website("reddit.com")]));
    e.onForegroundChanged("www.reddit.com", now);
    e.unlock(now);
    e.onForegroundChanged("old.reddit.com", now);
    expect(e.tick(now).type).toBe("inSession");
    expect(usage(e)).toHaveLength(1);
  });

  // --- Scheduling hints ---

  it("next evaluation is the earlier of session end and window change", () => {
    const e = engine(soft({ perOpenLimit: min(3) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    expect(e.nextEvaluationAt(now)).toBe(now + min(3));
    now = at("2026-11-16T23:58:00Z");
    e.tick(now);
    e.unlock(now);
    expect(e.nextEvaluationAt(now)).toBe(at("2026-11-17T00:00:00Z"));
  });

  // --- Idle ---

  it("idle: timed opens keep counting, untimed ones count as left", () => {
    const timed = engine(soft({ perOpenLimit: min(5) }));
    timed.onForegroundChanged(fgA, now);
    timed.unlock(now);
    timed.onForegroundChanged(fgA, now, true);
    expect(timed.idle).toBe(true);
    advance(min(5));
    expect(timed.tick(now).type).toBe("softGate"); // the open ran out while idle

    now = at("2026-11-16T10:00:00Z");
    const untimed = engine(soft({ maxOpens: 3 }));
    untimed.onForegroundChanged(fgA, now);
    untimed.unlock(now);
    untimed.onForegroundChanged(fgA, now, true);
    advance(sec(10));
    expect(untimed.onForegroundChanged(fgA, now).type).toBe("inSession"); // back within grace
    untimed.onForegroundChanged(fgA, now, true);
    advance(sec(20));
    expect(gate(untimed.onForegroundChanged(fgA, now)).opens).toEqual({ used: 1, max: 3 });
    expect(usage(untimed)[0]!.timeUsed).toBe(0);
  });

  it("idle survives a snapshot", () => {
    const e = engine(soft({ totalLimit: min(10) }));
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    e.onForegroundChanged(fgA, now, true);
    expect(new BlockEngine(UTC, e.sets, e.snapshot()).idle).toBe(true);
  });

  // --- Restart ---

  it("resumes from a snapshot", () => {
    const set = soft({ totalLimit: min(10) });
    const e = engine(set);
    e.onForegroundChanged(fgA, now);
    e.unlock(now);
    advance(min(4));
    const restored = new BlockEngine(UTC, [set], JSON.parse(JSON.stringify(e.snapshot())));
    advance(min(2));
    expect(restored.tick(now)).toEqual({ type: "inSession", remaining: min(4) });
  });

  it("duration formatting", () => {
    expect(formatDuration(min(15))).toBe("15 min");
    expect(formatDuration(min(90))).toBe("1 h 30 min");
    expect(formatDuration(sec(45))).toBe("45 s");
    expect(formatDuration(0)).toBe("0 s");
  });
});

/** Nested sets: a shared "Social" set (4 × 4 min) that includes reddit, plus a "Reddit" set (2 × 3 min). */
describe("overlapping soft sets", () => {
  let now = at("2026-11-16T22:00:00Z");
  let e: BlockEngine;
  beforeEach(() => {
    now = at("2026-11-16T22:00:00Z");
    e = new BlockEngine(UTC, [
      blockSet({ id: "social", name: "Social", mode: "soft", targets: [website("youtube.com"), website("reddit.com")],
        windows: allWeek, limitScope: "wholeSet", softLimits: softLimits({ maxOpens: 4, perOpenLimit: min(4) }) }),
      blockSet({ id: "reddit", name: "Reddit", mode: "soft", targets: [website("reddit.com")],
        windows: allWeek, softLimits: softLimits({ maxOpens: 2, perOpenLimit: min(3) }) }),
    ]);
  });
  const youtube = "www.youtube.com";
  const reddit = "www.reddit.com";
  const opens = (setId: string) => Object.values(e.usage).filter((u) => u.setId === setId).reduce((n, u) => n + u.opensUsed, 0);
  const advance = (m: number) => { now += min(m); };

  it("going to reddit during a social open only uses a reddit open", () => {
    e.onForegroundChanged(youtube, now);
    e.unlock(now);
    advance(1);
    expect(gate(e.onForegroundChanged(reddit, now)).gates.map((g) => g.setId)).toEqual(["reddit"]);
    e.unlock(now);
    expect(opens("social")).toBe(1);
    expect(opens("reddit")).toBe(1);
  });

  it("time on reddit also counts against the social open", () => {
    e.onForegroundChanged(youtube, now);
    e.unlock(now); // social open 1
    advance(1);
    e.onForegroundChanged(reddit, now);
    e.unlock(now); // reddit open 1
    advance(3);
    // Reddit's 3 min are up — and Social's open has now been used for 4 min, so it ends too.
    expect(new Set(gate(e.tick(now)).gates.map((g) => g.setId))).toEqual(new Set(["social", "reddit"]));
    e.unlock(now);
    expect(opens("social")).toBe(2); // Continue used a Social open as well
    expect(opens("reddit")).toBe(2);
  });

  it("opening reddit directly uses one of each", () => {
    expect(gate(e.onForegroundChanged(reddit, now)).gates).toHaveLength(2);
    e.unlock(now);
    expect(opens("social")).toBe(1);
    expect(opens("reddit")).toBe(1);
    expect(e.tick(now).type).toBe("inSession");
  });

  it("open history records start and on-screen time", () => {
    const start = now;
    e.onForegroundChanged(youtube, now);
    e.unlock(now);
    advance(2);
    e.onForegroundChanged(null, now); // not counted
    advance(10);
    e.onForegroundChanged(youtube, now); // past grace → new open needed
    e.unlock(now);
    advance(1);
    e.tick(now);
    expect(Object.values(e.usage)[0]!.opens).toEqual([
      { startedAt: start, used: min(2) },
      { startedAt: start + min(12), used: min(1) },
    ]);
  });
});

describe("shared limits", () => {
  let now = at("2026-11-16T10:00:00Z");
  beforeEach(() => { now = at("2026-11-16T10:00:00Z"); });
  const insta = "www.instagram.com";
  const tiktok = "www.tiktok.com";
  const reddit = "www.reddit.com";
  const social = (scope: "eachSite" | "wholeSet", limits: Partial<SoftLimits>) => new BlockEngine(UTC, [blockSet({
    id: "social", name: "Social media", mode: "soft",
    targets: [website("instagram.com"), website("tiktok.com"), website("reddit.com")],
    windows: allWeek, softLimits: softLimits(limits), limitScope: scope,
  })]);

  it("shared opens are used across all sites in the set", () => {
    const e = social("wholeSet", { maxOpens: 2, perOpenLimit: min(5) });
    e.onForegroundChanged(insta, now);
    e.unlock(now);
    now += min(5);
    e.tick(now);
    const g = gate(e.onForegroundChanged(tiktok, now));
    expect(g.opens).toEqual({ used: 1, max: 2 }); // Instagram's open counted for TikTok too
    expect(g.gates[0]!.target).toEqual(WHOLE_SET);
  });

  it("shared total time adds up across sites", () => {
    const e = social("wholeSet", { totalLimit: min(20) });
    e.onForegroundChanged(insta, now);
    e.unlock(now);
    now += min(12);
    e.onForegroundChanged(reddit, now); // switching within the set keeps the same open
    expect(e.tick(now)).toEqual({ type: "inSession", remaining: min(8) });
    now += min(8);
    expect(blocked(e.tick(now)).blockers[0]!.reason).toEqual({ type: "totalTimeExceeded", limit: min(20) });
    expect(e.onForegroundChanged(tiktok, now).type).toBe("blocked");
    expect(Object.keys(e.usage)).toHaveLength(1);
  });

  it("each-site scope keeps separate counts (default)", () => {
    const e = social("eachSite", { maxOpens: 2 });
    e.onForegroundChanged(insta, now);
    e.unlock(now);
    expect(gate(e.onForegroundChanged(tiktok, now)).opens).toEqual({ used: 0, max: 2 });
  });

  it("leaving the set entirely ends the shared open after grace", () => {
    const e = social("wholeSet", { maxOpens: 3 });
    e.onForegroundChanged(insta, now);
    e.unlock(now);
    e.onForegroundChanged("example.org", now);
    now += sec(60);
    expect(gate(e.onForegroundChanged(tiktok, now)).opens).toEqual({ used: 1, max: 3 });
  });
});
