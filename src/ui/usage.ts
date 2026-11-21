import type { AppState } from "../core/appState";
import { formatDuration } from "../core/decision";
import { type UsageEntry, usageKey } from "../core/engine";
import { type BlockSet, WHOLE_SET } from "../core/model";
import { scheduleOf } from "../core/schedule";
import type { Instant, Zone } from "../core/time";
import { formatTime, targetLabel } from "./format";

export interface UsageRow {
  readonly label: string;
  /** Domain for the icon, or null (shared count / adult list). */
  readonly domain: string | null;
  /** "1 of 2 opens left · 8 min of 20 min left" */
  readonly summary: string;
  readonly opens: readonly { readonly text: string; readonly current: boolean }[];
}

/**
 * This window's usage for the detail screen: per site (or for the whole set, if shared), every
 * open with its start time and on-screen duration. Null when the set isn't in a window.
 */
export function usageRows(set: BlockSet, state: AppState, now: Instant, zone: Zone): { since: Instant; rows: UsageRow[] } | null {
  const occurrence = scheduleOf(set.windows).occurrenceAtInstant(now, zone);
  if (!occurrence || !set.enabled) return null;
  const l = set.softLimits;
  const targets = set.limitScope === "wholeSet" ? [WHOLE_SET] : set.targets;
  const rows = targets.map((target): UsageRow => {
    const u: UsageEntry | undefined = state.usage[usageKey(set.id, target, occurrence.key)];
    const opensUsed = u?.opensUsed ?? 0;
    const timeUsed = u?.timeUsed ?? 0;
    const summary = set.mode === "reminder"
      ? `${formatDuration(timeUsed)} on screen this window`
      : [
          l.maxOpens === null ? `${opensUsed} opens` : `${Math.max(0, l.maxOpens - opensUsed)} of ${l.maxOpens} opens left`,
          l.totalLimit === null ? `${formatDuration(timeUsed)} used` : `${formatDuration(Math.max(0, l.totalLimit - timeUsed))} of ${formatDuration(l.totalLimit)} left`,
        ].join(" · ");
    const s = u?.session;
    const live = !!s && (s.leftAt === null || now - s.leftAt <= l.graceTime) && (l.perOpenLimit === null || s.used < l.perOpenLimit);
    const opens = (u?.opens ?? []).map((open, i, all) => {
      const current = live && i === all.length - 1;
      const tail = current ? (l.perOpenLimit !== null ? ` · open now, ${formatDuration(l.perOpenLimit - open.used)} left` : " · open now") : "";
      return { text: `Open ${i + 1} · ${formatTime(open.startedAt, zone)} · ${formatDuration(open.used)}${tail}`, current };
    });
    return { label: targetLabel(target), domain: target.kind === "website" ? target.domain : null, summary, opens };
  });
  return { since: occurrence.start, rows };
}
