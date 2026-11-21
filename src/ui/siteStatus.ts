import type { AppState } from "../core/appState";
import { describeBlocker, formatDuration } from "../core/decision";
import { BlockEngine } from "../core/engine";
import { setMatches } from "../core/model";
import type { Instant, Zone } from "../core/time";
import { softStats } from "../block/view";
import { blockPageModel } from "../background/presentation";

export interface SiteStatus {
  /** "Blocked" / "Limited" / "In an open" / "Reminders on" / "Not blocked" */
  readonly headline: string;
  readonly detail: string;
  /** Names of the sets that include this site. */
  readonly sets: readonly string[];
}

/** What the popup says about [host] right now (read-only: nothing is counted or changed). */
export function siteStatus(host: string, state: AppState, now: Instant, zone: Zone): SiteStatus {
  const engine = new BlockEngine(zone, state.sets, { usage: state.usage });
  const decision = engine.evaluate(host, now);
  const sets = state.sets.filter((s) => setMatches(s, host)).map((s) => s.name);
  switch (decision.type) {
    case "blocked":
      return { headline: "Blocked", detail: [...new Set(decision.blockers.map(describeBlocker))].join("\n"), sets };
    case "softGate": {
      const soft = blockPageModel(decision, host, state).soft;
      return { headline: "Limited", detail: soft ? softStats(soft) || "Continue on the block page to get in" : "", sets };
    }
    case "inSession":
      return { headline: "In an open", detail: decision.remaining === null ? "No time limit" : `${formatDuration(decision.remaining)} left`, sets };
    case "allow":
      return { headline: "Not blocked", detail: sets.length > 0 ? "None of its block sets are blocking right now" : "Not in any block set", sets };
  }
}
