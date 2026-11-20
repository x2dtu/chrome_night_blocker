// Time primitives. The engine works in two kinds of time:
//  - Instant: real time, epoch milliseconds (what Date.now() returns).
//  - LocalDateTime: wall-clock time in some zone, as milliseconds since 1970-01-01T00:00 *local*.
//    Its calendar fields are read with the UTC getters, so adding minutes is plain arithmetic and a
//    12am–8am window stays 12am–8am regardless of daylight saving.
// Converting between the two goes through a Zone.

/** A length of time in milliseconds. */
export type Millis = number;
/** Epoch milliseconds. */
export type Instant = number;
/** Wall-clock milliseconds since 1970-01-01T00:00 local time. */
export type LocalDateTime = number;

export const SECOND: Millis = 1000;
export const MINUTE: Millis = 60 * SECOND;
export const HOUR: Millis = 60 * MINUTE;
export const DAY: Millis = 24 * HOUR;
export const WEEK: Millis = 7 * DAY;

export const seconds = (n: number): Millis => n * SECOND;
export const minutes = (n: number): Millis => n * MINUTE;
export const hours = (n: number): Millis => n * HOUR;

/** Sunday = 0 … Saturday = 6 (same as Date.getDay()). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const SUNDAY = 0, MONDAY = 1, TUESDAY = 2, WEDNESDAY = 3, THURSDAY = 4, FRIDAY = 5, SATURDAY = 6;
export const ALL_DAYS: readonly DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayName(day: number): string {
  return DAY_NAMES[((day % 7) + 7) % 7]!;
}

export function nextDay(day: DayOfWeek): DayOfWeek {
  return ((day + 1) % 7) as DayOfWeek;
}

// --- LocalDateTime helpers ---

export function localDateTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): LocalDateTime {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** Parses "2026-11-16T22:00", "2026-11-16T22:00:30" or "2026-11-16T22:00:30.250". */
export function parseLocal(text: string): LocalDateTime {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text);
  if (!m) throw new Error(`Not a local date-time: ${text}`);
  const ms = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0, ms);
}

/** ISO text like "2026-11-16T22:00" (seconds only when non-zero). Used as occurrence keys. */
export function formatLocal(t: LocalDateTime): string {
  const d = new Date(t);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  let s = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) s += `:${pad(d.getUTCSeconds())}`;
  if (d.getUTCMilliseconds() !== 0) s += `.${pad(d.getUTCMilliseconds(), 3)}`;
  return s;
}

/** "2026-11-16" */
export function localDate(t: LocalDateTime): string {
  return formatLocal(t).slice(0, 10);
}

export function dayOfWeek(t: LocalDateTime): DayOfWeek {
  return new Date(t).getUTCDay() as DayOfWeek;
}

export function startOfDay(t: LocalDateTime): LocalDateTime {
  return Math.floor(t / DAY) * DAY;
}

/** Sunday 00:00 of the week containing [t]. */
export function startOfWeek(t: LocalDateTime): LocalDateTime {
  return startOfDay(t) - dayOfWeek(t) * DAY;
}

/** "11:30 PM"; 1440 (end of day) reads as "12:00 AM". */
export function clockLabel(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60) % 24;
  const m = minuteOfDay % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Clock label of a wall-clock time, e.g. "12:00 AM". */
export function formatClock(t: LocalDateTime): string {
  return clockLabel(Math.floor((t - startOfDay(t)) / MINUTE));
}

// --- Zones ---

export interface Zone {
  readonly id: string;
  /** Offset of local time from UTC at [instant], in ms (e.g. -8 h for PST). */
  offsetAt(instant: Instant): Millis;
}

export const UTC: Zone = { id: "UTC", offsetAt: () => 0 };

export function fixedOffsetZone(offset: Millis): Zone {
  return { id: `UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset) / HOUR}`, offsetAt: () => offset };
}

const zoneCache = new Map<string, Zone>();

/** An IANA zone such as "America/Los_Angeles", using the browser's (or Node's) time zone data. */
export function ianaZone(id: string): Zone {
  const cached = zoneCache.get(id);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: id,
    hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  });
  const zone: Zone = {
    id,
    offsetAt(instant) {
      const f: Record<string, number> = {};
      for (const p of format.formatToParts(new Date(instant))) {
        if (p.type !== "literal") f[p.type] = Number(p.value);
      }
      const wall = Date.UTC(f.year!, f.month! - 1, f.day!, f.hour! % 24, f.minute!, f.second!);
      return wall - Math.floor(instant / SECOND) * SECOND;
    },
  };
  zoneCache.set(id, zone);
  return zone;
}

/** The zone the browser runs in. */
export function systemZone(): Zone {
  return ianaZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function toLocal(instant: Instant, zone: Zone): LocalDateTime {
  return instant + zone.offsetAt(instant);
}

/**
 * Converts a wall-clock time to a real instant. In a fall-back overlap (the time happens twice)
 * this returns the earlier one. In a spring-forward gap (the time doesn't exist, e.g. 2:30am)
 * it returns the moment the gap ends — the first real instant at or after that wall-clock time.
 */
export function toInstant(local: LocalDateTime, zone: Zone): Instant {
  const before = zone.offsetAt(local - DAY);
  const after = zone.offsetAt(local + DAY);
  const valid = [...new Set([before, after])]
    .map((offset) => local - offset)
    .filter((instant) => toLocal(instant, zone) === local);
  if (valid.length > 0) return Math.min(...valid);
  // Gap: find the transition between the two candidate instants.
  let lo = Math.min(local - before, local - after);
  let hi = Math.max(local - before, local - after);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zone.offsetAt(mid) === after) hi = mid;
    else lo = mid;
  }
  return hi;
}
