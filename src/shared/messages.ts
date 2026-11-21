import type { ChangeOutcome } from "../core/changeReview";
import type { BlockSet } from "../core/model";
import type { SuspensionCheck } from "../core/suspension";
import type { Millis } from "../core/time";

/** Requests from extension pages (block page, options, popup) to the background worker. */
export type Request =
  | { readonly type: "ping" }
  /** What the block page for [url] (the blocked URL) should show. */
  | { readonly type: "getBlockPage"; readonly url: string }
  /** Continue pressed on the block page in the sender's tab. */
  | { readonly type: "continue" }
  | ActionRequest;

/**
 * Changes from the settings UI. The worker is the only writer of state. [pin] is checked by the
 * worker for sets that have one.
 */
export type ActionRequest =
  /** [pin] null = no PIN; otherwise the worker hashes it. The set's own pinHash is ignored. */
  | { readonly type: "createSet"; readonly set: BlockSet; readonly pin: string | null }
  /** Tightening applies now, loosening waits for the cooling-off. The PIN can't be changed here. */
  | { readonly type: "editSet"; readonly set: BlockSet; readonly pin?: string }
  | { readonly type: "setEnabled"; readonly setId: string; readonly enabled: boolean; readonly pin?: string }
  | { readonly type: "cancelPending"; readonly setId: string }
  | { readonly type: "suspend"; readonly setId: string; readonly pin?: string }
  | { readonly type: "deleteSet"; readonly setId: string; readonly pin?: string }
  /** Checks a PIN without changing anything (e.g. before opening the editor). */
  | { readonly type: "verifyPin"; readonly setId: string; readonly pin: string };

export type ActionResult =
  | { readonly ok: true; readonly outcome?: ChangeOutcome; readonly suspension?: SuspensionCheck }
  | { readonly ok: false; readonly error: string };

/** Messages from the worker to a page's content script. */
export type ContentMessage = {
  readonly type: "banner";
  /** "reddit.com · 10 minutes left" */
  readonly text: string;
  /** Block set name, shown underneath. */
  readonly setName: string;
  readonly color: string;
};

export interface BlockPageModel {
  /** "allowed" means the page should go back to the site (the worker does that). */
  readonly status: "blocked" | "softGate" | "allowed";
  readonly host: string;
  readonly setName: string;
  readonly color: string;
  readonly message: string;
  readonly streakDays: number;
  readonly reasons: readonly string[];
  readonly soft: SoftGateInfo | null;
}

export interface SoftGateInfo {
  readonly unlockDelay: Millis;
  readonly opensUsed: number;
  readonly maxOpens: number | null;
  readonly timeLeft: Millis | null;
  readonly totalLimit: Millis | null;
  /** "3 min per open", or "". */
  readonly limitsSummary: string;
}

export interface ContinueResult {
  readonly ok: boolean;
  readonly reason?: string;
}
