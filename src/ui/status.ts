import type { AppState } from "../core/appState";
import { formatDuration } from "../core/decision";
import { type BlockMode, type BlockSet, isSuspended } from "../core/model";
import { scheduleOf } from "../core/schedule";
import type { SuspensionCheck } from "../core/suspension";
import { type Instant, type Zone, toLocal } from "../core/time";
import { formatLocalNear, formatTime, formatTimeSeconds } from "./format";

export type SetState = "active" | "paused" | "upcoming" | "disabled";

export interface SetStatus {
  readonly state: SetState;
  /** "Until 8:00 AM", "Starts Mon 11:30 PM", … */
  readonly text: string;
  /** "Turns off at 11:42 PM" while a change waits out the cooling-off. */
  readonly pending: string | null;
}

export function statusOf(set: BlockSet, state: AppState, now: Instant, zone: Zone): SetStatus {
  const p = state.pendingChanges[set.id];
  const pending = p ? `${p.proposed.enabled ? "Changes apply" : "Turns off"} at ${formatTime(p.appliesAt, zone)}` : null;
  const local = toLocal(now, zone);
  const schedule = scheduleOf(set.windows);
  if (!set.enabled) return { state: "disabled", text: "Not blocking anything", pending };
  if (isSuspended(set, now)) return { state: "paused", text: `Until ${formatTimeSeconds(set.suspendedUntil!, zone)}`, pending };
  const occurrence = schedule.occurrenceAt(local);
  if (occurrence) return { state: "active", text: `Until ${formatLocalNear(occurrence.end, local)}`, pending };
  const next = schedule.nextChange(local);
  return { state: "upcoming", text: next === null ? "No schedule" : `Starts ${formatLocalNear(next, local)}`, pending };
}

export function stateLabel(state: SetState, mode: BlockMode): string {
  switch (state) {
    case "active": return mode === "reminder" ? "Tracking now" : "Blocking now";
    case "paused": return "Paused";
    case "upcoming": return "Waiting";
    case "disabled": return "Turned off";
  }
}

export function modeLabel(mode: BlockMode): string {
  return mode === "hard" ? "Hard" : mode === "soft" ? "Soft" : "Reminder";
}

/** Home screen subtitle. */
export function headerSubtitle(setCount: number, activeCount: number): string {
  if (setCount === 0) return "Block sites when you need to rest.";
  if (activeCount === 0) return "Nothing is blocked right now";
  return activeCount === 1 ? "1 block set is on right now" : `${activeCount} block sets are on right now`;
}

export function pauseText(check: SuspensionCheck, set: BlockSet, zone: Zone): string {
  switch (check.type) {
    case "allowed": return check.remainingAfter === null ? "Unlimited this window." : `${check.remainingAfter + 1} left this window.`;
    case "notInWindow": return set.enabled ? "Only available while the block set is on." : "The block set is turned off.";
    case "alreadySuspended": return `Paused until ${formatTimeSeconds(check.until, zone)}.`;
    case "limitReached": return `All ${check.max} pauses used this window.`;
    case "coolingDown": return `Next pause available at ${formatTimeSeconds(check.until, zone)}.`;
  }
}

/** Summary of a set's soft limits for the detail screen. */
export function limitRows(set: BlockSet): [string, string][] {
  const l = set.softLimits;
  return [
    ["Wait before Continue unlocks", l.unlockDelay === 0 ? "None" : formatDuration(l.unlockDelay)],
    ["Opens allowed", l.maxOpens?.toString() ?? "Unlimited"],
    ["Time per open", l.perOpenLimit === null ? "No limit" : formatDuration(l.perOpenLimit)],
    ["Total time", l.totalLimit === null ? "No limit" : formatDuration(l.totalLimit)],
    ["Grace period", formatDuration(l.graceTime)],
    ["Time warnings", l.timeWarnings && l.totalLimit !== null ? "At 10 and 1 min left" : "Off"],
    ["Usage reminders", l.reminderInterval === null ? "Off" : `Every ${formatDuration(l.reminderInterval)}`],
  ];
}
