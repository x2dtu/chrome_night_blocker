import type { Target } from "./model";
import { type LocalDateTime, type Millis, formatClock } from "./time";

export type BlockReason =
  /** Hard block set within its window. */
  | { readonly type: "scheduled" }
  /** Soft block whose total time limit is used up. */
  | { readonly type: "totalTimeExceeded"; readonly limit: Millis }
  /** Soft block whose opens are all used. */
  | { readonly type: "opensExhausted"; readonly maxOpens: number };

export interface Blocker {
  readonly setId: string;
  readonly setName: string;
  readonly target: Target;
  readonly reason: BlockReason;
  /** When this block lifts (end of the window occurrence), in local wall-clock time. */
  readonly until: LocalDateTime;
}

export interface Gate {
  readonly setId: string;
  readonly setName: string;
  readonly target: Target;
  readonly opensUsed: number;
  readonly maxOpens: number | null;
  /** Time used this window, for "8 of 12 min left". */
  readonly timeUsed: Millis;
  readonly totalLimit: Millis | null;
}

export interface OpenCount {
  readonly used: number;
  readonly max: number;
}

/** What to do about the site on screen. */
export type Decision =
  /** Nothing applies. */
  | { readonly type: "allow" }
  /**
   * Inside an unlocked soft-block open. [remaining] is the time until the open (or the total
   * limit) runs out, or null if unlimited — re-evaluate after it elapses.
   */
  | { readonly type: "inSession"; readonly remaining: Millis | null }
  /** Show the block page with only a "go to a new tab" button. [blockers] is sorted; the first is the primary reason. */
  | { readonly type: "blocked"; readonly blockers: readonly Blocker[] }
  /**
   * Show the soft block page. Continue (after [unlockDelay]) uses one open from every gate in
   * [gates]. [opens] is the most constrained open count among them, for the circles UI.
   */
  | { readonly type: "softGate"; readonly gates: readonly Gate[]; readonly unlockDelay: Millis; readonly opens: OpenCount | null };

export const ALLOW: Decision = { type: "allow" };

/** Human-readable "why", e.g. "Night Socials: screen time exceeded 15 min". */
export function describeBlocker(b: Blocker): string {
  switch (b.reason.type) {
    case "scheduled": return `${b.setName}: blocked until ${formatClock(b.until)}`;
    case "totalTimeExceeded": return `${b.setName}: screen time exceeded ${formatDuration(b.reason.limit)}`;
    case "opensExhausted": return `${b.setName}: all ${b.reason.maxOpens} opens used`;
  }
}

export function gateTimeLeft(g: Gate): Millis | null {
  return g.totalLimit === null ? null : Math.max(0, g.totalLimit - g.timeUsed);
}

/** "1 h 30 min", "15 min", "45 s", "0 s". */
export function formatDuration(d: Millis): string {
  const total = Math.floor(d / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} min`);
  if (s > 0 || (h === 0 && m === 0)) parts.push(`${s} s`);
  return parts.join(" ");
}
