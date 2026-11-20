import { describe, expect, it } from "vitest";
import { MINUTES_PER_DAY, WeeklySchedule, dayWindow } from "../../src/core/schedule";
import { ALL_DAYS, FRIDAY, MONDAY, SATURDAY, SUNDAY, THURSDAY, TUESDAY, WEDNESDAY } from "../../src/core/time";
import { describeDays, describeTimes, groupToWindows, groupWindows, windowGroup } from "../../src/core/windowGroups";

const hm = (h: number, m = 0) => h * 60 + m;
const shuffled = <T>(xs: T[]) => [...xs].sort(() => Math.random() - 0.5);

describe("window groups", () => {
  it("overnight windows on several days become one group", () => {
    const group = windowGroup([SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, SATURDAY], hm(23, 30), hm(8));
    const windows = groupToWindows(group);
    expect(windows).toHaveLength(12);
    const groups = groupWindows(shuffled(windows));
    expect(groups).toEqual([group]);
    expect(describeDays(groups[0]!.days)).toBe("Sun–Thu, Sat");
    expect(describeTimes(groups[0]!)).toBe("11:30 PM – 8:00 AM (next day)");
  });

  it("saturday night pairs with sunday morning", () => {
    const g = windowGroup([SATURDAY], hm(22), hm(7));
    expect(groupWindows(groupToWindows(g))).toEqual([g]);
  });

  it("separate ranges stay separate and sorted", () => {
    const windows = [
      ...groupToWindows(windowGroup([MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY], hm(9), hm(17))),
      ...groupToWindows(windowGroup([FRIDAY, SATURDAY], hm(22), hm(2))),
    ];
    const groups = groupWindows(windows);
    expect(groups).toHaveLength(2);
    expect(describeDays(groups[0]!.days)).toBe("Weekdays");
    expect(describeTimes(groups[0]!)).toBe("9:00 AM – 5:00 PM");
    expect(describeDays(groups[1]!.days)).toBe("Fri, Sat");
  });

  it("a lone morning window is not mistaken for an overnight tail", () => {
    const groups = groupWindows([dayWindow(MONDAY, 0, hm(8)), dayWindow(SUNDAY, hm(12), hm(13))]);
    expect(groups).toEqual([windowGroup([SUNDAY], hm(12), hm(13)), windowGroup([MONDAY], 0, hm(8))]);
  });

  it("until midnight and all day", () => {
    expect(describeTimes(windowGroup([FRIDAY], hm(22), MINUTES_PER_DAY))).toBe("10:00 PM – 12:00 AM");
    expect(groupToWindows(windowGroup([FRIDAY], hm(22), 0))).toEqual([dayWindow(FRIDAY, hm(22), MINUTES_PER_DAY)]);
    const allWeek = windowGroup(ALL_DAYS, 0, MINUTES_PER_DAY);
    expect(describeDays(allWeek.days)).toBe("Every day");
    expect(describeTimes(allWeek)).toBe("All day");
    expect(groupWindows(groupToWindows(allWeek))).toEqual([allWeek]);
  });

  it("weekends", () => {
    expect(describeDays([SATURDAY, SUNDAY])).toBe("Weekends");
    expect(describeDays([MONDAY, WEDNESDAY])).toBe("Mon, Wed");
  });

  it("round trip preserves coverage for arbitrary input", () => {
    const windows = [
      dayWindow(MONDAY, hm(23), MINUTES_PER_DAY), dayWindow(TUESDAY, 0, hm(6)),
      dayWindow(TUESDAY, hm(12), hm(13)), dayWindow(WEDNESDAY, 0, hm(3)),
    ];
    const back = groupWindows(windows).flatMap(groupToWindows);
    expect(new WeeklySchedule(back).equals(new WeeklySchedule(windows))).toBe(true);
  });
});
