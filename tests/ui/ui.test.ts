import { describe, expect, it } from "vitest";
import { EMPTY_STATE, type AppState } from "../../src/core/appState";
import { usageKey } from "../../src/core/engine";
import { blockSet, softLimits, website } from "../../src/core/model";
import { MINUTES_PER_DAY, dayWindow } from "../../src/core/schedule";
import { MONDAY, TUESDAY, UTC, minutes as min, seconds as sec } from "../../src/core/time";
import { buildSet, draftFrom, type Draft } from "../../src/ui/draft";
import { headerSubtitle, pauseText, stateLabel, statusOf } from "../../src/ui/status";
import { usageRows } from "../../src/ui/usage";
import { at } from "../core/helpers";

const night = [dayWindow(MONDAY, 23 * 60 + 30, MINUTES_PER_DAY), dayWindow(TUESDAY, 0, 8 * 60)];
const set = blockSet({ id: "s", name: "Bedtime", mode: "hard", targets: [website("reddit.com")], windows: night });
const state = (fields: Partial<AppState> = {}): AppState => ({ ...EMPTY_STATE, sets: [set], ...fields });

describe("status", () => {
  it("waiting, blocking, paused, off", () => {
    expect(statusOf(set, state(), at("2026-11-16T10:00:00Z"), UTC)).toEqual({ state: "upcoming", text: "Starts 11:30 PM", pending: null });
    expect(statusOf(set, state(), at("2026-11-17T10:00:00Z"), UTC).text).toBe("Starts Mon 11:30 PM");
    expect(statusOf(set, state(), at("2026-11-16T23:45:00Z"), UTC)).toEqual({ state: "active", text: "Until Tue 8:00 AM", pending: null });
    expect(statusOf(set, state(), at("2026-11-17T01:00:00Z"), UTC).text).toBe("Until 8:00 AM");
    const paused = { ...set, suspendedUntil: at("2026-11-17T01:01:05Z") };
    expect(statusOf(paused, state(), at("2026-11-17T01:00:00Z"), UTC).text).toBe("Until 1:01:05 AM");
    expect(statusOf({ ...set, enabled: false }, state(), at("2026-11-17T01:00:00Z"), UTC).state).toBe("disabled");
  });

  it("pending change", () => {
    const s = state({ pendingChanges: { s: { setId: "s", proposed: { ...set, enabled: false }, requestedAt: 0, appliesAt: at("2026-11-16T10:05:00Z") } } });
    expect(statusOf(set, s, at("2026-11-16T10:00:00Z"), UTC).pending).toBe("Turns off at 10:05 AM");
  });

  it("labels", () => {
    expect(stateLabel("active", "reminder")).toBe("Tracking now");
    expect(stateLabel("active", "hard")).toBe("Blocking now");
    expect(headerSubtitle(2, 1)).toBe("1 block set is on right now");
    expect(headerSubtitle(2, 0)).toBe("Nothing is blocked right now");
    expect(pauseText({ type: "allowed", remainingAfter: 1 }, set, UTC)).toBe("2 left this window.");
    expect(pauseText({ type: "limitReached", max: 3 }, set, UTC)).toBe("All 3 pauses used this window.");
  });
});

describe("usage rows", () => {
  it("lists every open, marking the live one", () => {
    const soft = blockSet({ ...set, mode: "soft", softLimits: softLimits({ maxOpens: 3, perOpenLimit: min(5), totalLimit: min(20) }) });
    const key = usageKey("s", website("reddit.com"), "2026-11-16T23:30");
    const s = state({ sets: [soft], usage: { [key]: {
      setId: "s", target: website("reddit.com"), occurrenceKey: "2026-11-16T23:30", opensUsed: 2, timeUsed: min(7),
      session: { used: min(2), leftAt: null }, warned: [], remindersSent: 0,
      opens: [{ startedAt: at("2026-11-16T23:40:00Z"), used: min(5) }, { startedAt: at("2026-11-16T23:52:00Z"), used: min(2) }],
    } } });
    const r = usageRows(soft, s, at("2026-11-16T23:54:00Z"), UTC)!;
    expect(r.rows[0]!.summary).toBe("1 of 3 opens left · 13 min of 20 min left");
    expect(r.rows[0]!.opens).toEqual([
      { text: "Open 1 · 11:40 PM · 5 min", current: false },
      { text: "Open 2 · 11:52 PM · 2 min · open now, 3 min left", current: true },
    ]);
    expect(usageRows(soft, s, at("2026-11-16T10:00:00Z"), UTC)).toBeNull();
  });
});

describe("editor draft", () => {
  const valid = (fields: Partial<Draft> = {}): Draft => ({
    ...draftFrom(null, () => "new"), name: "Bedtime", targets: [website("reddit.com")], windows: night, usePin: false, ...fields,
  });

  it("round-trips an existing set", () => {
    const soft = blockSet({ ...set, mode: "soft", softLimits: softLimits({ maxOpens: 3, perOpenLimit: min(5), unlockDelay: sec(10) }) });
    const r = buildSet(draftFrom(soft), soft);
    expect(r.ok && r.set).toEqual(soft);
  });

  it("required fields", () => {
    const r = buildSet({ ...valid(), name: " ", targets: [], windows: [] }, null);
    expect(!r.ok && r.errors).toEqual(["Give the block set a name", "Add at least one website", "Add at least one time window"]);
  });

  it("empty number fields mean no limit; bad ones are reported", () => {
    const ok = buildSet(valid({ mode: "soft", maxOpens: "", totalMin: "" }), null);
    expect(ok.ok && ok.set.softLimits.maxOpens).toBeNull();
    const bad = buildSet(valid({ mode: "soft", maxOpens: "0", perOpenMin: "2.5" }), null);
    expect(!bad.ok && bad.errors).toEqual(["Time per open must be a whole number, at least 1", "Opens allowed must be a whole number, at least 1"]);
  });

  it("soft reminders must be shorter than the limits", () => {
    const r = buildSet(valid({ mode: "soft", softReminders: true, reminderMin: "5", perOpenMin: "5", totalMin: "4" }), null);
    expect(!r.ok && r.errors).toEqual([
      "Reminder interval must be shorter than the time per open (5 min)",
      "Reminder interval must be shorter than the total time (4 min)",
    ]);
    const off = buildSet(valid({ mode: "soft", softReminders: false, reminderMin: "5", perOpenMin: "5" }), null);
    expect(off.ok && off.set.softLimits.reminderInterval).toBeNull();
    const reminder = buildSet(valid({ mode: "reminder", reminderMin: "15" }), null);
    expect(reminder.ok && reminder.set.softLimits.reminderInterval).toBe(min(15));
  });

  it("PIN for new sets", () => {
    expect(buildSet(valid({ usePin: true, pin: "12", pinConfirm: "12" }), null)).toEqual({ ok: false, errors: ["PIN must be 4–12 digits"] });
    expect(buildSet(valid({ usePin: true, pin: "1234", pinConfirm: "1235" }), null)).toEqual({ ok: false, errors: ["PINs don't match"] });
    const r = buildSet(valid({ usePin: true, pin: "1234", pinConfirm: "1234" }), null);
    expect(r.ok && r.pin).toBe("1234");
    expect(buildSet(valid(), null)).toMatchObject({ ok: true, pin: null });
  });
});
