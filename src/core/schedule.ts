import {
  type DayOfWeek, type Instant, type LocalDateTime, type Zone,
  MINUTE, WEEK, clockLabel, dayName, formatLocal, startOfWeek, toInstant, toLocal,
} from "./time";

export const MINUTES_PER_DAY = 24 * 60;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/**
 * A blocked segment within a single day, in local wall-clock minutes since midnight.
 * [endMinute] is exclusive; 1440 means "until midnight at the end of the day".
 *
 * A window that crosses midnight (Mon 11:30pm → Tue 8am) is stored as two segments
 * (Mon 23:30–24:00 and Tue 00:00–08:00). WeeklySchedule merges them back into one continuous
 * occurrence. This matches the 7-bar UI: each bar shows only its own day.
 */
export interface DayWindow {
  readonly day: DayOfWeek;
  readonly startMinute: number;
  readonly endMinute: number;
}

export function dayWindow(day: DayOfWeek, startMinute: number, endMinute: number): DayWindow {
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= MINUTES_PER_DAY) {
    throw new RangeError(`startMinute out of range: ${startMinute}`);
  }
  if (!Number.isInteger(endMinute) || endMinute <= startMinute || endMinute > MINUTES_PER_DAY) {
    throw new RangeError(`endMinute must be after start: ${endMinute}`);
  }
  return { day, startMinute, endMinute };
}

/**
 * One continuous active period of a schedule, in local wall-clock time. [key] (the start as ISO
 * text) uniquely identifies the occurrence: all per-occurrence counters (opens, time used,
 * pauses) are keyed on it and reset when a new occurrence begins.
 */
export interface WindowOccurrence {
  readonly start: LocalDateTime;
  readonly end: LocalDateTime;
  readonly key: string;
}

/**
 * A span of the weekly pattern in minutes since Sunday 00:00. [end] is exclusive and may exceed
 * one week when the span wraps from Saturday night into Sunday.
 */
export interface WeekSpan {
  readonly start: number;
  readonly end: number;
}

/** Half-open interval in minute-of-week. start is in [0, WEEK); end may exceed WEEK if it wraps past Saturday. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * The weekly time windows of a block set. The week runs Sunday 00:00 → Saturday 24:00.
 *
 * All math is done in local wall-clock time, so a 12am–8am window is always 12am–8am regardless
 * of daylight saving. Converting boundaries to real instants (for alarms) goes through
 * toInstant, which handles DST gaps and overlaps.
 *
 * Fall-back caveat: if a window ends inside the repeated hour (e.g. ends at 1:30am on the night
 * clocks go back), it ends at the first 1:30 and re-activates for the repeat. It's still the same
 * occurrence (same start), so counters carry over.
 *
 * If every minute of the week is covered, there is one occurrence per week starting Sunday 00:00.
 */
export class WeeklySchedule {
  private readonly spans: readonly Span[];

  constructor(readonly windows: readonly DayWindow[]) {
    this.spans = merge(windows);
  }

  get isEmpty(): boolean {
    return this.spans.length === 0;
  }

  occurrenceAt(now: LocalDateTime): WindowOccurrence | null {
    for (const c of this.candidateOccurrences(now)) {
      if (now >= c.start && now < c.end) return c;
    }
    return null;
  }

  occurrenceAtInstant(now: Instant, zone: Zone): WindowOccurrence | null {
    return this.occurrenceAt(toLocal(now, zone));
  }

  isActive(now: LocalDateTime): boolean {
    return this.occurrenceAt(now) !== null;
  }

  /** The next wall-clock time strictly after [now] at which the schedule turns on or off, or null if it never changes. */
  nextChange(now: LocalDateTime): LocalDateTime | null {
    let best: LocalDateTime | null = null;
    for (const c of this.candidateOccurrences(now)) {
      for (const t of [c.start, c.end]) {
        if (t > now && (best === null || t < best)) best = t;
      }
    }
    return best;
  }

  nextChangeInstant(now: Instant, zone: Zone): Instant | null {
    const next = this.nextChange(toLocal(now, zone));
    return next === null ? null : toInstant(next, zone);
  }

  /** Times (in the weekly pattern) when both this and [other] are active. Wrap-around spans are joined. */
  overlapWith(other: WeeklySchedule): WeekSpan[] {
    const a = this.coverage();
    const b = other.coverage();
    for (let i = 0; i < a.length; i++) a[i] = a[i]! & b[i]!;
    return spansOf(a);
  }

  /** True if every minute [other] is active, this is too. */
  covers(other: WeeklySchedule): boolean {
    const mine = this.coverage();
    const theirs = other.coverage();
    return theirs.every((bit, i) => bit === 0 || mine[i] === 1);
  }

  /** Equal when active at exactly the same times, regardless of how the windows were entered. */
  equals(other: WeeklySchedule): boolean {
    return this.spans.length === other.spans.length &&
      this.spans.every((s, i) => s.start === other.spans[i]!.start && s.end === other.spans[i]!.end);
  }

  private coverage(): Uint8Array {
    const bits = new Uint8Array(MINUTES_PER_WEEK);
    for (const span of this.spans) {
      if (span.end <= MINUTES_PER_WEEK) {
        bits.fill(1, span.start, span.end);
      } else {
        bits.fill(1, span.start, MINUTES_PER_WEEK);
        bits.fill(1, 0, span.end - MINUTES_PER_WEEK);
      }
    }
    return bits;
  }

  /** Occurrences anchored to last, this, and next week — enough to cover any wrap-around. */
  private candidateOccurrences(now: LocalDateTime): WindowOccurrence[] {
    const thisWeek = startOfWeek(now);
    const result: WindowOccurrence[] = [];
    for (const weekStart of [thisWeek - WEEK, thisWeek, thisWeek + WEEK]) {
      for (const span of this.spans) {
        const start = weekStart + span.start * MINUTE;
        result.push({ start, end: weekStart + span.end * MINUTE, key: formatLocal(start) });
      }
    }
    return result;
  }
}

const scheduleCache = new WeakMap<readonly DayWindow[], WeeklySchedule>();

/** The schedule for a stored window list, cached so repeated lookups don't re-merge. */
export function scheduleOf(windows: readonly DayWindow[]): WeeklySchedule {
  let s = scheduleCache.get(windows);
  if (!s) {
    s = new WeeklySchedule(windows);
    scheduleCache.set(windows, s);
  }
  return s;
}

function merge(windows: readonly DayWindow[]): Span[] {
  const sorted = windows
    .map((w) => [w.day * MINUTES_PER_DAY + w.startMinute, w.day * MINUTES_PER_DAY + w.endMinute] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  // Saturday-night window running into Sunday morning: join last and first.
  if (merged.length > 1 && merged[0]![0] === 0 && merged[merged.length - 1]![1] === MINUTES_PER_WEEK) {
    const first = merged.shift()!;
    const last = merged.pop()!;
    merged.push([last[0], MINUTES_PER_WEEK + first[1]]);
  }
  return merged.map(([start, end]) => ({ start, end }));
}

function spansOf(bits: Uint8Array): WeekSpan[] {
  const spans: { start: number; end: number }[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === 0) {
      i++;
      continue;
    }
    const start = i;
    while (i < bits.length && bits[i] === 1) i++;
    spans.push({ start, end: i });
  }
  if (spans.length > 1 && spans[0]!.start === 0 && spans[spans.length - 1]!.end === MINUTES_PER_WEEK) {
    const first = spans.shift()!;
    const last = spans.pop()!;
    spans.push({ start: last.start, end: MINUTES_PER_WEEK + first.end });
  }
  return spans;
}

/** e.g. "Mon 11:30 PM – Tue 8:00 AM", or "Fri 9:00 AM – 5:00 PM" within one day. */
export function describeWeekSpan(span: WeekSpan): string {
  const endMinute = span.end - 1; // label the end by the day of its last covered minute
  const startDay = Math.floor(span.start / MINUTES_PER_DAY);
  const endDay = Math.floor(endMinute / MINUTES_PER_DAY);
  const startLabel = `${dayName(startDay)} ${clockLabel(span.start % MINUTES_PER_DAY)}`;
  const endLabel = clockLabel((endMinute % MINUTES_PER_DAY) + 1);
  return startDay === endDay ? `${startLabel} – ${endLabel}` : `${startLabel} – ${dayName(endDay)} ${endLabel}`;
}
