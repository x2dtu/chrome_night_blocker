import { beforeAll, describe, expect, it } from "vitest";
import { EMPTY_STATE, deserializeState, serializeState, type AppState } from "../../src/core/appState";
import { type BlockSet, blockSet, website } from "../../src/core/model";
import { hashPin } from "../../src/core/pin";
import { MINUTES_PER_DAY, dayWindow } from "../../src/core/schedule";
import {
  addSet, cancelPending, deleteSet, maintain, nextPendingAt, requestEdit, setById, streakOf, suspend,
} from "../../src/core/stateActions";
import { ALL_DAYS, UTC } from "../../src/core/time";
import { at } from "./helpers";

describe("state actions", () => {
  const zone = UTC;
  const mon = at("2026-11-16T22:30:00Z"); // Monday, inside 22:00–24:00
  // Every night 22:00–24:00.
  const nightly = ALL_DAYS.map((d) => dayWindow(d, 22 * 60, MINUTES_PER_DAY));
  let pin: string;
  let set: BlockSet;
  let base: AppState;
  beforeAll(async () => {
    pin = await hashPin("1234");
    set = blockSet({ id: "s", name: "Bedtime", mode: "hard", targets: [website("a.com")], windows: nightly, pinHash: pin });
    base = addSet(EMPTY_STATE, set);
  });
  const withStreak = (s: AppState, days: number): AppState => ({ ...s, streaks: { s: { days, lastCountedDay: null, brokenDay: null } } });

  it("rejects duplicate ids", () => {
    expect(() => addSet(base, set)).toThrow();
  });

  it("tightening edit applies now and cancels pending", () => {
    const [pending] = requestEdit(base, { ...set, enabled: false }, mon, zone);
    expect(pending.pendingChanges.s).toBeDefined();
    const [s, outcome] = requestEdit(pending, { ...set, targets: [...set.targets, website("b.com")] }, mon, zone);
    expect(outcome.type).toBe("applyNow");
    expect(setById(s, "s")!.targets).toHaveLength(2);
    expect(s.pendingChanges).toEqual({});
  });

  it("pending change can be cancelled", () => {
    const [pending] = requestEdit(base, { ...set, enabled: false }, mon, zone);
    expect(cancelPending(pending, "s").pendingChanges).toEqual({});
  });

  it("turning off waits, then applies in maintenance and breaks streak", () => {
    const [pending, outcome] = requestEdit(withStreak(base, 4), { ...set, enabled: false }, mon, zone);
    if (outcome.type !== "pending") throw new Error("expected pending");
    const appliesAt = outcome.change.appliesAt;
    expect(nextPendingAt(pending)).toBe(appliesAt);
    expect(setById(maintain(pending, appliesAt - 1000, zone), "s")!.enabled).toBe(true);
    const applied = maintain(pending, appliesAt, zone);
    expect(setById(applied, "s")!.enabled).toBe(false);
    expect(streakOf(applied, "s").days).toBe(0);
    expect(applied.pendingChanges).toEqual({});
    expect(nextPendingAt(applied)).toBeNull();
  });

  it("pause breaks streak and is limited", () => {
    const [paused, check] = suspend(withStreak(base, 4), "s", mon, zone);
    expect(check.type).toBe("allowed");
    expect(streakOf(paused, "s").days).toBe(0);
    expect(setById(paused, "s")!.suspendedUntil).toBe(mon + 60_000);
    const [, again] = suspend(paused, "s", mon + 10_000, zone);
    expect(again.type).toBe("alreadySuspended");
  });

  it("streak counts completed nights", () => {
    let s = maintain(base, mon, zone);
    expect(s.activeOccurrences.s).toBe("2026-11-16T22:00");
    s = maintain(s, at("2026-11-17T00:00:00Z"), zone); // Monday's window ended
    expect(streakOf(s, "s").days).toBe(1);
    expect(s.activeOccurrences.s).toBeUndefined();
    s = maintain(s, at("2026-11-17T23:00:00Z"), zone);
    s = maintain(s, at("2026-11-18T01:00:00Z"), zone);
    expect(streakOf(s, "s").days).toBe(2);
    expect(streakOf(s, "s").lastCountedDay).toBe("2026-11-17");
  });

  it("paused night does not count", () => {
    let s = maintain(base, mon, zone);
    s = suspend(s, "s", mon, zone)[0];
    s = maintain(s, at("2026-11-17T00:00:00Z"), zone);
    expect(streakOf(s, "s").days).toBe(0);
  });

  it("delete requires turned off and clears everything", () => {
    expect(() => deleteSet(base, "s")).toThrow();
    const off: AppState = { ...base, sets: [{ ...set, enabled: false }], streaks: { s: { days: 2, lastCountedDay: null, brokenDay: null } } };
    expect(deleteSet(off, "s")).toEqual(EMPTY_STATE);
  });

  it("a PIN is optional", () => {
    const s = addSet(EMPTY_STATE, { ...set, id: "x", pinHash: null });
    expect(setById(s, "x")!.pinHash).toBeNull();
  });

  it("removing a PIN waits like other loosening edits", () => {
    const [s, outcome] = requestEdit(base, { ...set, pinHash: null }, mon, zone);
    expect(outcome.type).toBe("pending");
    expect(setById(s, "s")!.pinHash).toBe(pin);
  });
});

describe("stored state", () => {
  it("round-trips through JSON", () => {
    const set = blockSet({ id: "s", name: "Bedtime", mode: "hard", targets: [website("a.com")], windows: [dayWindow(1, 0, 60)] });
    const state: AppState = { ...EMPTY_STATE, sets: [set], streaks: { s: { days: 3, lastCountedDay: "2026-11-16", brokenDay: null } } };
    const stored = JSON.parse(JSON.stringify(serializeState(state)));
    expect(stored.version).toBe(1);
    expect(deserializeState(stored)).toEqual(state);
  });

  it("fills missing fields, rejects newer versions", () => {
    expect(deserializeState(undefined)).toEqual(EMPTY_STATE);
    expect(deserializeState({ version: 1, sets: [] })).toEqual(EMPTY_STATE);
    expect(() => deserializeState({ version: 99 })).toThrow();
  });
});
