import { type BlockSet, strictness, targetKey } from "./model";
import { scheduleOf } from "./schedule";
import type { Instant } from "./time";

/** A turn-off or loosening edit waiting out the set's cooling-off. One per set; a newer edit replaces it. */
export interface PendingChange {
  readonly setId: string;
  readonly proposed: BlockSet;
  readonly requestedAt: Instant;
  readonly appliesAt: Instant;
}

export function isDue(change: PendingChange, now: Instant): boolean {
  return now >= change.appliesAt;
}

/** Applies on top of the current set, keeping runtime state like an active pause. */
export function applyPending(change: PendingChange, current: BlockSet): BlockSet {
  return { ...change.proposed, suspendedUntil: current.suspendedUntil };
}

export type ChangeOutcome =
  | { readonly type: "applyNow"; readonly set: BlockSet }
  | { readonly type: "pending"; readonly change: PendingChange };

/**
 * Decides whether an edit (already PIN-verified) applies now or waits.
 * Tightening and cosmetic edits apply immediately. Anything that loosens — even mixed with
 * tightening — waits for the *current* set's cooling-off, so lowering the wait itself also waits.
 */
export function reviewChange(current: BlockSet, proposed: BlockSet, now: Instant): ChangeOutcome {
  if (current.id !== proposed.id) throw new Error("reviewChange needs the same set");
  const wait = current.protection.changeWait;
  if (!isLoosening(current, proposed) || wait === 0) {
    return { type: "applyNow", set: { ...proposed, suspendedUntil: current.suspendedUntil } };
  }
  return { type: "pending", change: { setId: current.id, proposed, requestedAt: now, appliesAt: now + wait } };
}

/** True if [next] would block anything less than [old] does, or weakens its protections. */
export function isLoosening(old: BlockSet, next: BlockSet): boolean {
  if (old.enabled && !next.enabled) return true;
  if (!next.enabled) return false; // editing an already turned-off set can't loosen anything further
  if (!old.enabled) return false; // turning on is tightening
  if (strictness(next.mode) < strictness(old.mode)) return true;
  if (old.pinHash !== null && next.pinHash === null) return true; // removing the PIN
  const nextTargets = new Set(next.targets.map(targetKey));
  if (!old.targets.every((t) => nextTargets.has(targetKey(t)))) return true;
  if (!scheduleOf(next.windows).covers(scheduleOf(old.windows))) return true;

  if (old.mode === "soft" && next.mode === "soft") {
    const o = old.softLimits;
    const n = next.softLimits;
    if (n.unlockDelay < o.unlockDelay) return true;
    if (looser(o.maxOpens, n.maxOpens)) return true;
    if (looser(o.perOpenLimit, n.perOpenLimit)) return true;
    if (looser(o.totalLimit, n.totalLimit)) return true;
    if (n.graceTime > o.graceTime) return true;
    if (old.limitScope === "wholeSet" && next.limitScope === "eachSite") return true;
  }

  const o = old.protection;
  const n = next.protection;
  if (n.suspensionDuration > o.suspensionDuration) return true;
  if (looser(o.maxSuspensions, n.maxSuspensions)) return true;
  if (n.suspensionCooldown < o.suspensionCooldown) return true;
  if (n.changeWait < o.changeWait) return true;
  return false;
}

/** For limits where null means unlimited. */
function looser(old: number | null, next: number | null): boolean {
  return old !== null && (next === null || next > old);
}
