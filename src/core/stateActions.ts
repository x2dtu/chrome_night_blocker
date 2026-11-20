import type { AppState } from "./appState";
import { type ChangeOutcome, applyPending, isDue, isLoosening, reviewChange } from "./changeReview";
import type { BlockSet } from "./model";
import { scheduleOf } from "./schedule";
import { NO_STREAK, type Streak, breakStreak, occurrenceCompleted, streakDayFor } from "./streak";
import { type SuspensionCheck, checkSuspension, suspend as suspendSet } from "./suspension";
import type { Instant, Zone } from "./time";

// User actions and housekeeping as pure transitions on AppState. PIN checks happen in the UI
// before calling these.

export function setById(state: AppState, id: string): BlockSet | undefined {
  return state.sets.find((s) => s.id === id);
}

export function streakOf(state: AppState, id: string): Streak {
  return state.streaks[id] ?? NO_STREAK;
}

export function addSet(state: AppState, set: BlockSet): AppState {
  if (state.sets.some((s) => s.id === set.id)) throw new Error(`Duplicate set id ${set.id}`);
  return { ...state, sets: [...state.sets, set] };
}

/**
 * Submits an edit (including turning off/on). Tightening applies now; loosening becomes the set's
 * pending change. Any new edit replaces an existing pending change, since that change was based on
 * the older settings.
 */
export function requestEdit(state: AppState, proposed: BlockSet, now: Instant, zone: Zone): [AppState, ChangeOutcome] {
  const current = setById(state, proposed.id);
  if (!current) throw new Error(`No set ${proposed.id}`);
  const outcome = reviewChange(current, proposed, now);
  const withoutPending = { ...state, pendingChanges: without(state.pendingChanges, proposed.id) };
  const next = outcome.type === "applyNow"
    ? applySet(withoutPending, current, outcome.set, now, zone)
    : { ...withoutPending, pendingChanges: { ...withoutPending.pendingChanges, [proposed.id]: outcome.change } };
  return [next, outcome];
}

export function cancelPending(state: AppState, setId: string): AppState {
  return { ...state, pendingChanges: without(state.pendingChanges, setId) };
}

/** Emergency pause. Breaks the streak. */
export function suspend(state: AppState, setId: string, now: Instant, zone: Zone): [AppState, SuspensionCheck] {
  const set = setById(state, setId);
  if (!set) throw new Error(`No set ${setId}`);
  const check = checkSuspension(set, state.suspensions[setId], now, zone);
  if (check.type !== "allowed") return [state, check];
  const [suspended, suspension] = suspendSet(set, state.suspensions[setId], now, zone);
  const next: AppState = {
    ...replaceSet(state, suspended),
    suspensions: { ...state.suspensions, [setId]: suspension },
    streaks: { ...state.streaks, [setId]: breakStreak(streakOf(state, setId), streakDayFor(set, now, zone)) },
  };
  return [next, check];
}

/** Only turned-off sets can be deleted, so deleting can't skip the cooling-off. */
export function deleteSet(state: AppState, setId: string): AppState {
  const set = setById(state, setId);
  if (!set) return state;
  if (set.enabled) throw new Error("Turn the block set off before deleting it");
  return {
    sets: state.sets.filter((s) => s.id !== setId),
    usage: Object.fromEntries(Object.entries(state.usage).filter(([, u]) => u.setId !== setId)),
    suspensions: without(state.suspensions, setId),
    pendingChanges: without(state.pendingChanges, setId),
    streaks: without(state.streaks, setId),
    activeOccurrences: without(state.activeOccurrences, setId),
  };
}

/** Applies due pending changes and credits streaks for completed window occurrences. */
export function maintain(state: AppState, now: Instant, zone: Zone): AppState {
  let s = state;
  for (const [id, change] of Object.entries(state.pendingChanges)) {
    if (!isDue(change, now)) continue;
    const current = setById(s, id);
    s = { ...s, pendingChanges: without(s.pendingChanges, id) };
    if (current) s = applySet(s, current, applyPending(change, current), now, zone);
  }
  const occurrences: Record<string, string> = { ...s.activeOccurrences };
  const streaks: Record<string, Streak> = { ...s.streaks };
  for (const set of s.sets) {
    const current = set.enabled ? scheduleOf(set.windows).occurrenceAtInstant(now, zone)?.key ?? null : null;
    const previous = occurrences[set.id];
    if (previous !== undefined && previous !== current) {
      streaks[set.id] = occurrenceCompleted(streaks[set.id] ?? NO_STREAK, previous.slice(0, 10));
    }
    if (current !== null) occurrences[set.id] = current;
    else delete occurrences[set.id];
  }
  const ids = new Set(s.sets.map((x) => x.id));
  for (const id of Object.keys(occurrences)) if (!ids.has(id)) delete occurrences[id];
  return { ...s, activeOccurrences: occurrences, streaks };
}

/** When maintain next needs to run for pending changes (window ends are covered by the engine's schedule). */
export function nextPendingAt(state: AppState): Instant | null {
  const times = Object.values(state.pendingChanges).map((c) => c.appliesAt);
  return times.length > 0 ? Math.min(...times) : null;
}

function applySet(state: AppState, old: BlockSet, next: BlockSet, now: Instant, zone: Zone): AppState {
  const replaced = replaceSet(state, next);
  if (!isLoosening(old, next)) return replaced;
  return { ...replaced, streaks: { ...state.streaks, [old.id]: breakStreak(streakOf(state, old.id), streakDayFor(old, now, zone)) } };
}

function replaceSet(state: AppState, set: BlockSet): AppState {
  return { ...state, sets: state.sets.map((s) => (s.id === set.id ? set : s)) };
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record;
  return rest;
}
