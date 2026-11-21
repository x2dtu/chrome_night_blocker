// Pure helpers for the block page, so the text and states are unit-testable.

import { MINUTE, type Millis } from "../core/time";
import type { BlockPageModel, SoftGateInfo } from "../shared/messages";

/** "Bedtime · blocked" / "Night Socials · limited" */
export function chipText(model: BlockPageModel): string {
  return `${model.setName} · ${model.status === "softGate" ? "limited" : "blocked"}`;
}

export function streakText(days: number): string {
  return days > 0 ? `🔥 ${days}-day streak — don't break it` : "";
}

/** "8 of 20 min left" (seconds dropped), or "<1 min of 20 min left" in the last minute. */
export function timeLeftText(left: Millis, total: Millis): string {
  const totalMin = Math.floor(total / MINUTE);
  const leftMin = Math.floor(left / MINUTE);
  return leftMin < 1 ? `<1 min of ${totalMin} min left` : `${leftMin} of ${totalMin} min left`;
}

/** "2/4 opens left · 8 of 20 min left" — whichever parts apply. */
export function softStats(soft: SoftGateInfo): string {
  const parts: string[] = [];
  if (soft.maxOpens !== null) parts.push(`${soft.maxOpens - soft.opensUsed}/${soft.maxOpens} opens left`);
  if (soft.timeLeft !== null && soft.totalLimit !== null) parts.push(timeLeftText(soft.timeLeft, soft.totalLimit));
  return parts.join(" · ");
}

/** One circle per open, like lives: used ones hollow, the one Continue would use blinks, the rest filled. */
export type DotState = "used" | "next" | "left";

export function openDots(used: number, max: number): DotState[] {
  return Array.from({ length: max }, (_, i) => (i < used ? "used" : i === used ? "next" : "left"));
}

export function continueLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Continue in ${secondsLeft}s` : "Continue to site";
}

/** A new key restarts the unlock countdown (a different gate, or an open was used). */
export function resetKey(model: BlockPageModel): string {
  return `${model.status}:${model.host}:${model.soft?.opensUsed ?? ""}`;
}
