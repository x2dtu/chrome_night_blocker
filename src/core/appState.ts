import type { PendingChange } from "./changeReview";
import type { UsageEntry } from "./engine";
import type { BlockSet } from "./model";
import type { Streak } from "./streak";
import type { SuspensionState } from "./suspension";

/**
 * Everything the extension persists in chrome.storage.local. Plain JSON: records are keyed by
 * block set id, except [usage] (keyed by usageKey()).
 */
export interface AppState {
  readonly sets: readonly BlockSet[];
  readonly usage: Readonly<Record<string, UsageEntry>>;
  readonly suspensions: Readonly<Record<string, SuspensionState>>;
  readonly pendingChanges: Readonly<Record<string, PendingChange>>;
  readonly streaks: Readonly<Record<string, Streak>>;
  /** Last seen window occurrence key per set; a change means an occurrence completed (for streaks). */
  readonly activeOccurrences: Readonly<Record<string, string>>;
}

export const EMPTY_STATE: AppState = {
  sets: [],
  usage: {},
  suspensions: {},
  pendingChanges: {},
  streaks: {},
  activeOccurrences: {},
};

export const STATE_VERSION = 1;

export interface StoredState extends AppState {
  readonly version: number;
}

export function serializeState(state: AppState): StoredState {
  return { version: STATE_VERSION, ...state };
}

/** Reads what was stored, filling in fields added since it was written. Throws on a newer version. */
export function deserializeState(raw: unknown): AppState {
  if (raw === undefined || raw === null) return EMPTY_STATE;
  if (typeof raw !== "object") throw new Error("Stored state is not an object");
  const r = raw as Partial<StoredState>;
  if ((r.version ?? STATE_VERSION) > STATE_VERSION) {
    throw new Error(`Stored state version ${r.version} is newer than this extension`);
  }
  return {
    sets: r.sets ?? [],
    usage: r.usage ?? {},
    suspensions: r.suspensions ?? {},
    pendingChanges: r.pendingChanges ?? {},
    streaks: r.streaks ?? {},
    activeOccurrences: r.activeOccurrences ?? {},
  };
}
