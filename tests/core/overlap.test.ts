import { afterEach, describe, expect, it } from "vitest";
import { setAdultSiteMatcher } from "../../src/core/adultSites";
import { ADULT_SITES, type Target, blockSet, website } from "../../src/core/model";
import { describeOverlap, findOverlaps } from "../../src/core/overlap";
import { type DayWindow, MINUTES_PER_DAY, dayWindow, describeWeekSpan } from "../../src/core/schedule";
import { FRIDAY, MONDAY, SATURDAY, SUNDAY, TUESDAY } from "../../src/core/time";

const hm = (h: number, m = 0) => h * 60 + m;
const reddit = website("reddit.com");
const set = (id: string, targets: Target[], ...windows: DayWindow[]) =>
  blockSet({ id, name: id[0]!.toUpperCase() + id.slice(1), mode: "hard", targets, windows });

describe("overlap warnings", () => {
  afterEach(() => setAdultSiteMatcher(null));

  it("reports overlapping times for a shared site", () => {
    const bedtime = set("bedtime", [reddit], dayWindow(MONDAY, hm(23), MINUTES_PER_DAY), dayWindow(TUESDAY, 0, hm(8)));
    const edited = set("night", [reddit], dayWindow(MONDAY, hm(23, 30), MINUTES_PER_DAY), dayWindow(TUESDAY, 0, hm(9)));
    const warnings = findOverlaps(edited, [bedtime]);
    expect(warnings).toHaveLength(1);
    expect(describeOverlap(warnings[0]!, "reddit.com")).toBe("reddit.com is also in Bedtime: Mon 11:30 PM – Tue 8:00 AM");
  });

  it("same site at non-overlapping times is fine", () => {
    const day = set("day", [reddit], dayWindow(FRIDAY, hm(9), hm(17)));
    const night = set("night", [reddit], dayWindow(FRIDAY, hm(17), hm(23)));
    expect(findOverlaps(night, [day])).toEqual([]);
  });

  it("different sites at the same time is fine", () => {
    const a = set("a", [website("a.com")], dayWindow(FRIDAY, hm(9), hm(17)));
    const b = set("b", [website("b.com")], dayWindow(FRIDAY, hm(9), hm(17)));
    expect(findOverlaps(a, [b])).toEqual([]);
  });

  it("subdomain websites overlap", () => {
    const a = set("a", [reddit], dayWindow(FRIDAY, hm(9), hm(17)));
    const b = set("b", [website("old.reddit.com")], dayWindow(FRIDAY, hm(12), hm(13)));
    expect(findOverlaps(a, [b]).map((w) => w.spans.map(describeWeekSpan))).toEqual([["Fri 12:00 PM – 1:00 PM"]]);
    const c = set("c", [website("notreddit.com")], dayWindow(FRIDAY, hm(12), hm(13)));
    expect(findOverlaps(a, [c])).toEqual([]);
  });

  it("ignores itself and joins saturday-sunday wrap", () => {
    const windows = [dayWindow(SATURDAY, hm(22), MINUTES_PER_DAY), dayWindow(SUNDAY, 0, hm(8))];
    const a = set("a", [reddit], ...windows);
    const b = set("b", [reddit], ...windows);
    expect(findOverlaps(a, [a])).toEqual([]);
    expect(findOverlaps(a, [b]).map((w) => w.spans.map(describeWeekSpan))).toEqual([["Sat 10:00 PM – Sun 8:00 AM"]]);
  });

  it("window ending at midnight reads as 12 AM", () => {
    const a = set("a", [reddit], dayWindow(FRIDAY, hm(22), MINUTES_PER_DAY));
    expect(findOverlaps(a, [{ ...a, id: "b" }])[0]!.spans.map(describeWeekSpan)).toEqual(["Fri 10:00 PM – 12:00 AM"]);
  });

  it("adult list overlaps with itself and with listed sites", () => {
    setAdultSiteMatcher((h) => h === "adult.example");
    const w = [dayWindow(FRIDAY, hm(22), MINUTES_PER_DAY)];
    const a = set("a", [ADULT_SITES], ...w);
    expect(findOverlaps(a, [set("b", [ADULT_SITES], ...w)])).toHaveLength(1);
    expect(findOverlaps(a, [set("c", [website("adult.example")], ...w)])).toHaveLength(1);
    expect(findOverlaps(a, [set("d", [reddit], ...w)])).toEqual([]);
  });
});
