import type { BlockSet } from "./model";
import { scheduleOf } from "./schedule";
import { type Instant, type Zone, localDate, toLocal } from "./time";

/**
 * Daily streak for a block set. Days are local dates as "2026-11-16".
 *  - A day counts when a window occurrence that *started* that day completes cleanly.
 *  - Days with no window neither count nor break the streak.
 *  - A pause, turning off, or loosening edit breaks it, and that day can't count.
 */
export interface Streak {
  readonly days: number;
  readonly lastCountedDay: string | null;
  readonly brokenDay: string | null;
}

export const NO_STREAK: Streak = { days: 0, lastCountedDay: null, brokenDay: null };

/** [day] = start date of the occurrence the break happened in (or today if outside a window). */
export function breakStreak(s: Streak, day: string): Streak {
  return { ...s, days: 0, brokenDay: day };
}

/** Call when a window occurrence ends. [day] = the date it started. */
export function occurrenceCompleted(s: Streak, day: string): Streak {
  if (day === s.brokenDay || day === s.lastCountedDay) return s;
  return { ...s, days: s.days + 1, lastCountedDay: day };
}

/** The day a streak break is charged to: the start date of the current occurrence, or today if outside a window. */
export function streakDayFor(set: BlockSet, now: Instant, zone: Zone): string {
  const occurrence = scheduleOf(set.windows).occurrenceAtInstant(now, zone);
  return localDate(occurrence ? occurrence.start : toLocal(now, zone));
}
