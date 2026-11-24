import type { Target } from "../core/model";
import { type Instant, type LocalDateTime, type Zone, dayName, dayOfWeek, formatClock, localDate, toLocal } from "../core/time";

/** "11:42 PM" */
export function formatTime(instant: Instant, zone: Zone): string {
  return formatClock(toLocal(instant, zone));
}

/** "11:42:05 PM" (for short pauses, where seconds matter). */
export function formatTimeSeconds(instant: Instant, zone: Zone): string {
  const local = toLocal(instant, zone);
  const s = String(new Date(local).getUTCSeconds()).padStart(2, "0");
  return formatClock(local).replace(/ (AM|PM)$/, `:${s} $1`);
}

/** Time only if [t] is on the same day as [now], otherwise with the weekday: "Mon 11:30 PM". */
export function formatLocalNear(t: LocalDateTime, now: LocalDateTime): string {
  return localDate(t) === localDate(now) ? formatClock(t) : `${dayName(dayOfWeek(t))} ${formatClock(t)}`;
}

export function targetLabel(t: Target): string {
  switch (t.kind) {
    case "website": return t.domain;
    case "adult": return "Adult websites";
    case "wholeSet": return "All sites together";
  }
}

/** Set colors, same as the Android app. */
export const SET_COLORS = ["#5c6bc0", "#26a69a", "#ef5350", "#ffa726", "#ab47bc", "#42a5f5", "#66bb6a", "#8d6e63"] as const;
