import { describe, expect, it } from "vitest";
import { MINUTES_PER_DAY, WeeklySchedule, dayWindow, describeWeekSpan } from "../../src/core/schedule";
import {
  ALL_DAYS, FRIDAY, MONDAY, SATURDAY, SUNDAY, TUESDAY, WEDNESDAY,
  formatClock, formatLocal, ianaZone, parseLocal as at, toInstant, toLocal,
} from "../../src/core/time";

// Reference week: Sun 2026-11-15 … Sat 2026-11-21.
const hm = (h: number, m = 0) => h * 60 + m;
const la = ianaZone("America/Los_Angeles");
const utc = (text: string) => Date.parse(text);

describe("WeeklySchedule", () => {
  it("start is inclusive, end is exclusive", () => {
    const s = new WeeklySchedule([dayWindow(MONDAY, hm(9), hm(17))]);
    expect(s.isActive(at("2026-11-16T08:59:59"))).toBe(false);
    expect(s.isActive(at("2026-11-16T09:00"))).toBe(true);
    expect(s.isActive(at("2026-11-16T16:59:59"))).toBe(true);
    expect(s.isActive(at("2026-11-16T17:00"))).toBe(false);
    expect(s.isActive(at("2026-11-17T10:00"))).toBe(false);
  });

  it("empty schedule is never active", () => {
    const s = new WeeklySchedule([]);
    expect(s.isEmpty).toBe(true);
    expect(s.occurrenceAt(at("2026-11-16T10:00"))).toBeNull();
    expect(s.nextChange(at("2026-11-16T10:00"))).toBeNull();
  });

  it("window crossing midnight is one occurrence", () => {
    const s = new WeeklySchedule([dayWindow(MONDAY, hm(23, 30), MINUTES_PER_DAY), dayWindow(TUESDAY, 0, hm(8))]);
    const beforeMidnight = s.occurrenceAt(at("2026-11-16T23:45"))!;
    const afterMidnight = s.occurrenceAt(at("2026-11-17T03:00"))!;
    expect(afterMidnight).toEqual(beforeMidnight);
    expect(afterMidnight.start).toBe(at("2026-11-16T23:30"));
    expect(afterMidnight.end).toBe(at("2026-11-17T08:00"));
    expect(afterMidnight.key).toBe("2026-11-16T23:30");
  });

  it("consecutive nights are separate occurrences with different keys", () => {
    const s = new WeeklySchedule([
      dayWindow(MONDAY, hm(23, 30), MINUTES_PER_DAY), dayWindow(TUESDAY, 0, hm(8)),
      dayWindow(TUESDAY, hm(23, 30), MINUTES_PER_DAY), dayWindow(WEDNESDAY, 0, hm(8)),
    ]);
    const mon = s.occurrenceAt(at("2026-11-17T01:00"))!;
    const tue = s.occurrenceAt(at("2026-11-18T01:00"))!;
    expect(mon.key).not.toBe(tue.key);
  });

  it("saturday night wraps into sunday morning", () => {
    const s = new WeeklySchedule([dayWindow(SUNDAY, 0, hm(8)), dayWindow(SATURDAY, hm(22), MINUTES_PER_DAY)]);
    const sat = s.occurrenceAt(at("2026-11-21T23:00"))!;
    const sun = s.occurrenceAt(at("2026-11-22T07:00"))!;
    expect(sun).toEqual(sat);
    expect(sun.start).toBe(at("2026-11-21T22:00"));
    expect(sun.end).toBe(at("2026-11-22T08:00"));
    // Sunday morning at the start of the reference week belongs to the previous Saturday.
    expect(s.occurrenceAt(at("2026-11-15T07:00"))!.start).toBe(at("2026-11-14T22:00"));
  });

  it("adjacent and overlapping windows merge", () => {
    const s = new WeeklySchedule([
      dayWindow(FRIDAY, hm(9), hm(12)), dayWindow(FRIDAY, hm(12), hm(14)), dayWindow(FRIDAY, hm(13), hm(15)),
    ]);
    const occ = s.occurrenceAt(at("2026-11-20T12:30"))!;
    expect(occ.start).toBe(at("2026-11-20T09:00"));
    expect(occ.end).toBe(at("2026-11-20T15:00"));
  });

  it("whole week covered resets each sunday", () => {
    const s = new WeeklySchedule(ALL_DAYS.map((d) => dayWindow(d, 0, MINUTES_PER_DAY)));
    expect(s.occurrenceAt(at("2026-11-21T23:59"))!.start).toBe(at("2026-11-15T00:00"));
    expect(s.occurrenceAt(at("2026-11-22T00:00"))!.start).toBe(at("2026-11-22T00:00"));
  });

  it("next change finds upcoming start and end", () => {
    const s = new WeeklySchedule([dayWindow(MONDAY, hm(9), hm(17))]);
    expect(s.nextChange(at("2026-11-16T08:00"))).toBe(at("2026-11-16T09:00"));
    expect(s.nextChange(at("2026-11-16T09:00"))).toBe(at("2026-11-16T17:00"));
    expect(s.nextChange(at("2026-11-16T17:00"))).toBe(at("2026-11-23T09:00"));
  });

  it("equality ignores how windows were entered", () => {
    const night = new WeeklySchedule([dayWindow(MONDAY, hm(22), MINUTES_PER_DAY)]);
    const split = new WeeklySchedule([dayWindow(MONDAY, hm(22), hm(23)), dayWindow(MONDAY, hm(23), MINUTES_PER_DAY)]);
    expect(split.equals(night)).toBe(true);
    expect(night.equals(new WeeklySchedule([dayWindow(MONDAY, hm(21), MINUTES_PER_DAY)]))).toBe(false);
  });

  it("covers and overlap", () => {
    const night = new WeeklySchedule([dayWindow(MONDAY, hm(22), MINUTES_PER_DAY)]);
    const longer = new WeeklySchedule([dayWindow(MONDAY, hm(21), MINUTES_PER_DAY)]);
    expect(longer.covers(night)).toBe(true);
    expect(night.covers(longer)).toBe(false);
    expect(night.overlapWith(longer).map(describeWeekSpan)).toEqual(["Mon 10:00 PM – 12:00 AM"]);
  });

  // --- Daylight saving (US 2026: spring forward Sun Mar 8, fall back Sun Nov 1) ---

  it("spring forward keeps wall-clock window", () => {
    const s = new WeeklySchedule([dayWindow(SUNDAY, 0, hm(8))]);
    const at759 = utc("2026-03-08T14:59:00Z"); // 7:59 PDT
    const at800 = utc("2026-03-08T15:00:00Z"); // 8:00 PDT
    expect(s.occurrenceAtInstant(at759, la)).not.toBeNull();
    expect(s.occurrenceAtInstant(at800, la)).toBeNull();
    // Window end converts to 8:00 PDT, not shifted by an hour.
    expect(s.nextChangeInstant(utc("2026-03-08T09:00:00Z"), la)).toBe(at800); // from 1:00 PST
  });

  it("fall back keeps wall-clock window", () => {
    const s = new WeeklySchedule([dayWindow(SUNDAY, 0, hm(8))]);
    expect(s.nextChangeInstant(utc("2026-11-01T08:00:00Z"), la)).toBe(utc("2026-11-01T16:00:00Z")); // 8:00 PST
    // Both passes through the repeated 1:30am are in the same occurrence.
    const first = utc("2026-11-01T08:30:00Z"); // 1:30 PDT
    const second = utc("2026-11-01T09:30:00Z"); // 1:30 PST
    expect(formatClock(toLocal(first, la))).toBe("1:30 AM");
    expect(formatClock(toLocal(second, la))).toBe("1:30 AM");
    expect(s.occurrenceAtInstant(second, la)).toEqual(s.occurrenceAtInstant(first, la));
  });

  it("start inside spring-forward gap converts to end of gap", () => {
    const s = new WeeklySchedule([dayWindow(SUNDAY, hm(2, 30), hm(8))]);
    const start = s.nextChangeInstant(utc("2026-03-08T09:00:00Z"), la);
    // 2:30am doesn't exist; the window becomes active at 3:00am PDT.
    expect(start).toBe(utc("2026-03-08T10:00:00Z"));
    expect(s.occurrenceAtInstant(start!, la)).not.toBeNull();
  });

  it("rejects empty day window", () => {
    expect(() => dayWindow(MONDAY, hm(9), hm(9))).toThrow(RangeError);
  });
});

describe("time helpers", () => {
  it("toInstant picks the earlier time in an overlap", () => {
    expect(toInstant(at("2026-11-01T01:30"), la)).toBe(utc("2026-11-01T08:30:00Z"));
    expect(toInstant(at("2026-07-01T12:00"), la)).toBe(utc("2026-07-01T19:00:00Z"));
  });

  it("formats keys like java.time", () => {
    expect(formatLocal(at("2026-11-16T22:00"))).toBe("2026-11-16T22:00");
    expect(formatLocal(at("2026-11-16T22:00:05"))).toBe("2026-11-16T22:00:05");
  });
});
