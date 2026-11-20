import { type DayWindow, MINUTES_PER_DAY, dayWindow } from "./schedule";
import { type DayOfWeek, clockLabel, dayName, nextDay } from "./time";

/**
 * A time range as the user thinks of it, applied to several days: "Sun–Thu, 11:30 PM – 8:00 AM".
 * [start]/[end] are minutes of the day. If end <= start the range runs past midnight and ends the
 * next day. Storage stays per-day (DayWindow); this is the editing/display view.
 * [days] is sorted and has no duplicates.
 */
export interface WindowGroup {
  readonly days: readonly DayOfWeek[];
  readonly start: number;
  readonly end: number;
}

export function windowGroup(days: Iterable<DayOfWeek>, start: number, end: number): WindowGroup {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) throw new RangeError("A window group needs at least one day");
  if (start < 0 || start >= MINUTES_PER_DAY || end < 0 || end > MINUTES_PER_DAY) {
    throw new RangeError(`Times out of range: ${start}–${end}`);
  }
  return { days: sorted, start, end };
}

export function isOvernight(g: WindowGroup): boolean {
  return g.end >= 1 && g.end <= g.start;
}

export function groupToWindows(g: WindowGroup): DayWindow[] {
  return g.days.flatMap((d) => windowsFor(d, g.start, g.end));
}

/** "11:30 PM – 8:00 AM (next day)" */
export function describeTimes(g: WindowGroup): string {
  if (g.start === 0 && g.end === MINUTES_PER_DAY) return "All day";
  return `${clockLabel(g.start)} – ${clockLabel(g.end)}${isOvernight(g) ? " (next day)" : ""}`;
}

/** One day's window, split at midnight if end <= start (and end > 0). */
export function windowsFor(day: DayOfWeek, start: number, end: number): DayWindow[] {
  if (end > start) return [dayWindow(day, start, end)];
  if (end === 0) return [dayWindow(day, start, MINUTES_PER_DAY)];
  return [dayWindow(day, start, MINUTES_PER_DAY), dayWindow(nextDay(day), 0, end)];
}

/**
 * Reassembles per-day windows into groups: the before- and after-midnight pieces of an overnight
 * window become one range, and identical ranges on different days are merged.
 */
export function groupWindows(windows: readonly DayWindow[]): WindowGroup[] {
  const seen = new Set<string>();
  const pieces = windows
    .filter((w) => {
      const k = `${w.day}:${w.startMinute}:${w.endMinute}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.day - b.day || a.startMinute - b.startMinute);
  const used = pieces.map(() => false);
  const ranges: [DayOfWeek, number, number][] = [];

  // Pair "… → midnight" pieces with the next day's "midnight → …" piece.
  pieces.forEach((p, i) => {
    if (p.endMinute !== MINUTES_PER_DAY || p.startMinute === 0) return;
    const j = pieces.findIndex((q, k) =>
      !used[k] && k !== i && q.day === nextDay(p.day) && q.startMinute === 0 && q.endMinute <= p.startMinute);
    if (j < 0) return;
    used[i] = true;
    used[j] = true;
    ranges.push([p.day, p.startMinute, pieces[j]!.endMinute]);
  });
  pieces.forEach((p, i) => {
    if (!used[i]) ranges.push([p.day, p.startMinute, p.endMinute]);
  });

  const byTimes = new Map<string, { start: number; end: number; days: DayOfWeek[] }>();
  for (const [day, start, end] of ranges) {
    const k = `${start}-${end}`;
    const g = byTimes.get(k) ?? { start, end, days: [] };
    g.days.push(day);
    byTimes.set(k, g);
  }
  return [...byTimes.values()]
    .map((g) => windowGroup(g.days, g.start, g.end))
    .sort((a, b) => a.days[0]! - b.days[0]! || a.start - b.start);
}

const WEEKDAYS = "1,2,3,4,5";
const WEEKEND = "0,6";

/** "Every day", "Weekdays", "Weekends", or compact runs like "Sun–Thu, Sat". */
export function describeDays(days: Iterable<DayOfWeek>): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.join(",") === WEEKDAYS) return "Weekdays";
  if (sorted.join(",") === WEEKEND) return "Weekends";
  const runs: DayOfWeek[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1]! + 1 === d) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) => {
      if (run.length === 1) return dayName(run[0]!);
      if (run.length === 2) return `${dayName(run[0]!)}, ${dayName(run[1]!)}`;
      return `${dayName(run[0]!)}–${dayName(run[run.length - 1]!)}`;
    })
    .join(", ");
}
