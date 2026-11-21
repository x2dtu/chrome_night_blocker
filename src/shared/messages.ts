import type { Millis } from "../core/time";

/** Requests from extension pages (block page, options, popup) to the background worker. */
export type Request =
  | { readonly type: "ping" }
  /** What the block page for [url] (the blocked URL) should show. */
  | { readonly type: "getBlockPage"; readonly url: string }
  /** Continue pressed on the block page in the sender's tab. */
  | { readonly type: "continue" };

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
