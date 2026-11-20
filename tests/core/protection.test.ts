import { describe, expect, it } from "vitest";
import { applyPending, isDue, isLoosening, reviewChange } from "../../src/core/changeReview";
import { type BlockSet, blockSet, protectionSettings, softLimits, website } from "../../src/core/model";
import { hashPin, isValidPin, verifyPin } from "../../src/core/pin";
import { MINUTES_PER_DAY, dayWindow } from "../../src/core/schedule";
import { NO_STREAK, breakStreak, occurrenceCompleted } from "../../src/core/streak";
import { type SuspensionState, checkSuspension, suspend } from "../../src/core/suspension";
import { MONDAY, TUESDAY, UTC, minutes as min, seconds as sec } from "../../src/core/time";
import { at } from "./helpers";

describe("PIN", () => {
  it("hash verifies only the right pin", async () => {
    const stored = await hashPin("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
    expect(stored).not.toContain("4821");
    expect(stored).toMatch(/^pbkdf2-sha256\$120000\$/);
  });

  it("same pin hashes differently each time", async () => {
    expect(await hashPin("1234")).not.toBe(await hashPin("1234"));
  });

  it("pin validation", async () => {
    expect(isValidPin("0000")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("1234567890123")).toBe(false);
    expect(await verifyPin("1234", "garbage")).toBe(false);
    expect(await verifyPin("1234", "pbkdf2-sha256$x$y$z")).toBe(false);
    await expect(hashPin("12")).rejects.toThrow();
  });
});

describe("emergency pause", () => {
  const zone = UTC;
  const set = blockSet({
    id: "s", name: "Bedtime", mode: "hard", targets: [website("a.com")],
    windows: [dayWindow(MONDAY, 0, MINUTES_PER_DAY - 60), dayWindow(TUESDAY, 0, MINUTES_PER_DAY - 60)],
    protection: protectionSettings({ suspensionDuration: min(1), maxSuspensions: 2, suspensionCooldown: sec(30) }),
  });
  const monday = at("2026-11-16T10:00:00Z");

  it("pauses for the configured duration", () => {
    const [paused, state] = suspend(set, null, monday, zone);
    expect(paused.suspendedUntil).toBe(monday + sec(60));
    expect(state.used).toBe(1);
    expect(checkSuspension(paused, state, monday, zone)).toEqual({ type: "alreadySuspended", until: monday + sec(60) });
  });

  it("cooldown after a pause ends", () => {
    const [paused, state] = suspend(set, null, monday, zone);
    const endsAt = state.lastEndsAt!;
    expect(checkSuspension(paused, state, monday + sec(70), zone)).toEqual({ type: "coolingDown", until: endsAt + sec(30) });
    expect(checkSuspension(paused, state, endsAt + sec(30), zone)).toEqual({ type: "allowed", remainingAfter: 0 });
  });

  it("limit per occurrence, fresh allowance next occurrence", () => {
    let s: BlockSet = set;
    let state: SuspensionState | null = null;
    let now = monday;
    for (let i = 0; i < 2; i++) {
      [s, state] = suspend(s, state, now, zone);
      now += sec(120);
    }
    expect(checkSuspension(s, state, now, zone)).toEqual({ type: "limitReached", max: 2 });
    // Tuesday's occurrence (Monday's ended at 23:00).
    expect(checkSuspension(s, state, at("2026-11-17T01:00:00Z"), zone)).toEqual({ type: "allowed", remainingAfter: 1 });
  });

  it("nothing to pause outside a window", () => {
    expect(checkSuspension(set, null, at("2026-11-18T10:00:00Z"), zone)).toEqual({ type: "notInWindow" });
    expect(checkSuspension({ ...set, enabled: false }, null, monday, zone)).toEqual({ type: "notInWindow" });
  });
});

describe("cooling-off (change review)", () => {
  const now = at("2026-11-16T10:00:00Z");
  const night = [dayWindow(MONDAY, 22 * 60, MINUTES_PER_DAY)];
  const longerNight = [dayWindow(MONDAY, 21 * 60, MINUTES_PER_DAY)];
  const soft = blockSet({
    id: "s", name: "Night Socials", mode: "soft", targets: [website("a.com")], windows: night,
    softLimits: softLimits({ unlockDelay: sec(10), maxOpens: 4, perOpenLimit: min(3), totalLimit: min(15) }),
  });
  const loosens = (change: (s: BlockSet) => Partial<BlockSet>) => isLoosening(soft, { ...soft, ...change(soft) });
  const limits = (s: BlockSet, l: object) => ({ softLimits: { ...s.softLimits, ...l } });
  const protection = (s: BlockSet, p: object) => ({ protection: { ...s.protection, ...p } });

  it("loosening edits", () => {
    expect(loosens(() => ({ enabled: false }))).toBe(true);
    expect(loosens(() => ({ targets: [] }))).toBe(true);
    expect(loosens(() => ({ windows: [dayWindow(MONDAY, 23 * 60, MINUTES_PER_DAY)] }))).toBe(true);
    expect(loosens((s) => limits(s, { maxOpens: 5 }))).toBe(true);
    expect(loosens((s) => limits(s, { maxOpens: null }))).toBe(true);
    expect(loosens((s) => limits(s, { totalLimit: min(20) }))).toBe(true);
    expect(loosens((s) => limits(s, { unlockDelay: 0 }))).toBe(true);
    expect(loosens((s) => limits(s, { graceTime: min(5) }))).toBe(true);
    expect(loosens((s) => protection(s, { changeWait: 0 }))).toBe(true);
    expect(loosens((s) => protection(s, { maxSuspensions: 10 }))).toBe(true);
    expect(isLoosening({ ...soft, mode: "hard" }, soft)).toBe(true);
  });

  it("tightening and cosmetic edits", () => {
    expect(loosens(() => ({ name: "Renamed", message: "Sleep!", color: "#000000" }))).toBe(false);
    expect(loosens((s) => ({ targets: [...s.targets, website("b.com")] }))).toBe(false);
    expect(loosens(() => ({ windows: longerNight }))).toBe(false);
    expect(loosens((s) => limits(s, { maxOpens: 2, totalLimit: min(10) }))).toBe(false);
    expect(loosens(() => ({ mode: "hard" }))).toBe(false);
    expect(isLoosening({ ...soft, enabled: false }, soft)).toBe(false);
  });

  it("same sites in a different order is not loosening", () => {
    const two = { ...soft, targets: [website("a.com"), website("b.com")] };
    expect(isLoosening(two, { ...two, targets: [website("b.com"), website("a.com")] })).toBe(false);
  });

  it("mixed edit counts as loosening", () => {
    expect(loosens((s) => ({ targets: [...s.targets, website("b.com")], ...limits(s, { maxOpens: 8 }) }))).toBe(true);
  });

  it("shared to per-site is loosening, per-site to shared is not", () => {
    const shared = { ...soft, limitScope: "wholeSet" as const };
    expect(isLoosening(shared, soft)).toBe(true);
    expect(isLoosening(soft, shared)).toBe(false);
  });

  it("switching to reminder mode is loosening, away from it is not", () => {
    const reminder = { ...soft, mode: "reminder" as const };
    expect(isLoosening(soft, reminder)).toBe(true);
    expect(isLoosening({ ...soft, mode: "hard" }, soft)).toBe(true);
    expect(isLoosening(reminder, soft)).toBe(false);
  });

  it("loosening waits for the current cooling-off", () => {
    const proposed = { ...soft, enabled: false, protection: { ...soft.protection, changeWait: 0 } };
    const outcome = reviewChange(soft, proposed, now);
    if (outcome.type !== "pending") throw new Error("expected pending");
    expect(outcome.change.appliesAt).toBe(now + min(5));
    expect(isDue(outcome.change, now + min(4))).toBe(false);
    expect(isDue(outcome.change, now + min(5))).toBe(true);
  });

  it("no cooling-off applies loosening now", () => {
    const noWait = { ...soft, protection: { ...soft.protection, changeWait: 0 } };
    expect(reviewChange(noWait, { ...noWait, enabled: false }, now).type).toBe("applyNow");
  });

  it("tightening applies now and keeps active pause", () => {
    const current = { ...soft, suspendedUntil: now + sec(30) };
    const outcome = reviewChange(current, { ...current, suspendedUntil: null, windows: longerNight }, now);
    if (outcome.type !== "applyNow") throw new Error("expected applyNow");
    expect(outcome.set.suspendedUntil).toBe(now + sec(30));
    const pending = { setId: "s", proposed: { ...soft, enabled: false }, requestedAt: now, appliesAt: now };
    expect(applyPending(pending, current).suspendedUntil).toBe(now + sec(30));
  });
});

describe("streak", () => {
  const mon = "2026-11-16";

  it("counts once per day with a completed window", () => {
    let s = occurrenceCompleted(NO_STREAK, mon);
    s = occurrenceCompleted(s, mon);
    s = occurrenceCompleted(s, "2026-11-17");
    expect(s.days).toBe(2);
  });

  it("days without windows do not break it", () => {
    expect(occurrenceCompleted(occurrenceCompleted(NO_STREAK, mon), "2026-11-19").days).toBe(2);
  });

  it("break resets and the broken day cannot count", () => {
    const s = occurrenceCompleted(breakStreak(occurrenceCompleted(NO_STREAK, mon), "2026-11-17"), "2026-11-17");
    expect(s.days).toBe(0);
    expect(occurrenceCompleted(s, "2026-11-18").days).toBe(1);
  });
});
