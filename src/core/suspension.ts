import { type BlockSet } from "./model";
import { scheduleOf } from "./schedule";
import type { Instant, Zone } from "./time";

/** Emergency pauses used in one window occurrence. A different occurrence key means a fresh allowance. */
export interface SuspensionState {
  readonly occurrenceKey: string;
  readonly used: number;
  readonly lastEndsAt: Instant | null;
}

export type SuspensionCheck =
  /** [remainingAfter] = pauses left after this one, null if unlimited. */
  | { readonly type: "allowed"; readonly remainingAfter: number | null }
  /** Nothing to pause: the set isn't in a window (or is turned off). */
  | { readonly type: "notInWindow" }
  | { readonly type: "alreadySuspended"; readonly until: Instant }
  | { readonly type: "limitReached"; readonly max: number }
  | { readonly type: "coolingDown"; readonly until: Instant };

/**
 * Emergency pause of a whole block set (the PIN is checked by the caller first).
 * Limited per window occurrence, with a cooldown between pauses.
 */
export function checkSuspension(set: BlockSet, state: SuspensionState | null | undefined, now: Instant, zone: Zone): SuspensionCheck {
  if (!set.enabled) return { type: "notInWindow" };
  const occurrence = scheduleOf(set.windows).occurrenceAtInstant(now, zone);
  if (!occurrence) return { type: "notInWindow" };
  if (set.suspendedUntil !== null && set.suspendedUntil > now) return { type: "alreadySuspended", until: set.suspendedUntil };
  const current = state && state.occurrenceKey === occurrence.key ? state : { occurrenceKey: occurrence.key, used: 0, lastEndsAt: null };
  const p = set.protection;
  if (p.maxSuspensions !== null && current.used >= p.maxSuspensions) return { type: "limitReached", max: p.maxSuspensions };
  if (current.lastEndsAt !== null && current.lastEndsAt + p.suspensionCooldown > now) {
    return { type: "coolingDown", until: current.lastEndsAt + p.suspensionCooldown };
  }
  return { type: "allowed", remainingAfter: p.maxSuspensions === null ? null : p.maxSuspensions - current.used - 1 };
}

/** Returns the paused set and the updated state. Throws if checkSuspension doesn't allow it. */
export function suspend(set: BlockSet, state: SuspensionState | null | undefined, now: Instant, zone: Zone): [BlockSet, SuspensionState] {
  const result = checkSuspension(set, state, now, zone);
  if (result.type !== "allowed") throw new Error(`Pause not allowed: ${result.type}`);
  const key = scheduleOf(set.windows).occurrenceAtInstant(now, zone)!.key;
  const used = state && state.occurrenceKey === key ? state.used : 0;
  const until = now + set.protection.suspensionDuration;
  return [{ ...set, suspendedUntil: until }, { occurrenceKey: key, used: used + 1, lastEndsAt: until }];
}
