import { isAdultSite } from "./adultSites";
import { hostMatchesDomain } from "./hosts";
import type { BlockSet, Target } from "./model";
import { type WeekSpan, describeWeekSpan, scheduleOf } from "./schedule";

/** [target] in the set being edited is also covered by [otherSet] during [spans]. */
export interface OverlapWarning {
  readonly target: Target;
  readonly otherTarget: Target;
  readonly otherSet: BlockSet;
  readonly spans: readonly WeekSpan[];
}

/** "reddit.com is also in Bedtime: Mon 11:30 PM – Tue 8:00 AM" */
export function describeOverlap(w: OverlapWarning, targetLabel: string): string {
  return `${targetLabel} is also in ${w.otherSet.name}: ${w.spans.map(describeWeekSpan).join(", ")}`;
}

/**
 * Warnings for targets of [edited] that another set also blocks at overlapping times.
 * Turned-off sets are included since they can be turned back on. Websites overlap when one
 * domain is the same as or a subdomain of the other.
 */
export function findOverlaps(edited: BlockSet, others: readonly BlockSet[]): OverlapWarning[] {
  const warnings: OverlapWarning[] = [];
  for (const other of others) {
    if (other.id === edited.id) continue;
    const spans = scheduleOf(edited.windows).overlapWith(scheduleOf(other.windows));
    if (spans.length === 0) continue;
    for (const target of edited.targets) {
      for (const otherTarget of other.targets) {
        if (targetsOverlap(target, otherTarget)) warnings.push({ target, otherTarget, otherSet: other, spans });
      }
    }
  }
  return warnings;
}

export function targetsOverlap(a: Target, b: Target): boolean {
  if (a.kind === "website" && b.kind === "website") {
    return hostMatchesDomain(a.domain, b.domain) || hostMatchesDomain(b.domain, a.domain);
  }
  if (a.kind === "adult" && b.kind === "adult") return true;
  if (a.kind === "adult" && b.kind === "website") return isAdultSite(b.domain);
  if (a.kind === "website" && b.kind === "adult") return isAdultSite(a.domain);
  return false;
}
