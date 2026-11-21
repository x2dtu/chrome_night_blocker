// The editor's working copy of a block set. Numbers are kept as text so a field can be empty
// (= no limit). build() turns it into a BlockSet or a list of problems.

import {
  type BlockMode, type BlockSet, type LimitScope, type Target, DEFAULT_PROTECTION, DEFAULT_REMINDER_INTERVAL,
  DEFAULT_SOFT_LIMITS, blockSet, protectionSettings, softLimits,
} from "../core/model";
import { isValidPin, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "../core/pin";
import type { DayWindow } from "../core/schedule";
import { MINUTE, SECOND } from "../core/time";
import { SET_COLORS } from "./format";

export interface Draft {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly mode: BlockMode;
  readonly message: string;
  readonly targets: readonly Target[];
  readonly windows: readonly DayWindow[];
  readonly limitScope: LimitScope;
  readonly unlockDelaySec: string;
  readonly maxOpens: string;
  readonly perOpenMin: string;
  readonly totalMin: string;
  readonly graceSec: string;
  readonly timeWarnings: boolean;
  /** Soft sets: whether usage reminders are on. Reminder sets always remind. */
  readonly softReminders: boolean;
  readonly reminderMin: string;
  readonly suspensionMin: string;
  readonly maxSuspensions: string;
  readonly cooldownSec: string;
  readonly changeWaitMin: string;
  /** New sets only. */
  readonly usePin: boolean;
  readonly pin: string;
  readonly pinConfirm: string;
}

const text = (n: number | null, unit: number) => (n === null ? "" : String(Math.round(n / unit)));

export function draftFrom(set: BlockSet | null, newId: () => string = () => crypto.randomUUID()): Draft {
  const l = set?.softLimits ?? DEFAULT_SOFT_LIMITS;
  const p = set?.protection ?? DEFAULT_PROTECTION;
  return {
    id: set?.id ?? newId(),
    name: set?.name ?? "",
    color: set?.color ?? SET_COLORS[0],
    mode: set?.mode ?? "hard",
    message: set?.message ?? "",
    targets: set?.targets ?? [],
    windows: set?.windows ?? [],
    limitScope: set?.limitScope ?? "eachSite",
    unlockDelaySec: text(l.unlockDelay, SECOND),
    maxOpens: l.maxOpens?.toString() ?? "",
    perOpenMin: text(l.perOpenLimit, MINUTE),
    totalMin: text(l.totalLimit, MINUTE),
    graceSec: text(l.graceTime, SECOND),
    timeWarnings: l.timeWarnings,
    softReminders: set?.mode === "soft" && l.reminderInterval !== null,
    reminderMin: text(l.reminderInterval ?? DEFAULT_REMINDER_INTERVAL, MINUTE),
    suspensionMin: text(p.suspensionDuration, MINUTE),
    maxSuspensions: p.maxSuspensions?.toString() ?? "",
    cooldownSec: text(p.suspensionCooldown, SECOND),
    changeWaitMin: text(p.changeWait, MINUTE),
    usePin: true,
    pin: "",
    pinConfirm: "",
  };
}

export type BuildResult =
  | { readonly ok: true; readonly set: BlockSet; /** New sets: the PIN to set, or null for none. */ readonly pin: string | null }
  | { readonly ok: false; readonly errors: readonly string[] };

/** [original] null = creating. */
export function buildSet(d: Draft, original: BlockSet | null): BuildResult {
  const errors: string[] = [];
  const num = (value: string, field: string, min = 0): number | null => {
    if (value.trim() === "") return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
      errors.push(`${field} must be a whole number, at least ${min}`);
      return null;
    }
    return n;
  };

  if (d.name.trim() === "") errors.push("Give the block set a name");
  if (d.targets.length === 0) errors.push("Add at least one website");
  if (d.windows.length === 0) errors.push("Add at least one time window");
  const perOpen = num(d.perOpenMin, "Time per open", 1);
  const total = num(d.totalMin, "Total time", 1);

  let reminderInterval: number | null = null;
  if (d.mode === "reminder" || (d.mode === "soft" && d.softReminders)) {
    const m = num(d.reminderMin, "Reminder interval", 1);
    if (m === null && d.reminderMin.trim() === "") errors.push("Enter how often to remind you");
    reminderInterval = m === null ? null : m * MINUTE;
  }
  if (d.mode === "soft" && reminderInterval !== null) {
    // A reminder that can never come up would be confusing.
    if (perOpen !== null && reminderInterval >= perOpen * MINUTE) {
      errors.push(`Reminder interval must be shorter than the time per open (${perOpen} min)`);
    }
    if (total !== null && reminderInterval >= total * MINUTE) {
      errors.push(`Reminder interval must be shorter than the total time (${total} min)`);
    }
  }

  const limits = {
    unlockDelay: (num(d.unlockDelaySec, "Wait before Continue unlocks") ?? 0) * SECOND,
    maxOpens: num(d.maxOpens, "Opens allowed", 1),
    perOpenLimit: perOpen === null ? null : perOpen * MINUTE,
    totalLimit: total === null ? null : total * MINUTE,
    graceTime: (num(d.graceSec, "Grace period") ?? 15) * SECOND,
    timeWarnings: d.timeWarnings,
    reminderInterval,
  };
  const protection = {
    suspensionDuration: (num(d.suspensionMin, "Emergency pause length", 1) ?? 1) * MINUTE,
    maxSuspensions: num(d.maxSuspensions, "Emergency pauses allowed"),
    suspensionCooldown: (num(d.cooldownSec, "Wait between pauses") ?? 30) * SECOND,
    changeWait: (num(d.changeWaitMin, "Cooling-off period") ?? 5) * MINUTE,
  };

  let pin: string | null = null;
  if (original === null && d.usePin) {
    if (!isValidPin(d.pin)) errors.push(`PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits`);
    else if (d.pin !== d.pinConfirm) errors.push("PINs don't match");
    else pin = d.pin;
  }
  if (errors.length > 0) return { ok: false, errors };

  const set = blockSet({
    ...(original ?? {}),
    id: d.id,
    name: d.name.trim(),
    mode: d.mode,
    targets: d.targets,
    windows: d.windows,
    softLimits: softLimits(limits),
    limitScope: d.limitScope,
    protection: protectionSettings(protection),
    message: d.message.trim(),
    color: d.color,
  });
  return { ok: true, set, pin };
}

/** Best-effort set for live overlap warnings (ignores the number fields). */
export function previewSet(d: Draft): BlockSet {
  return blockSet({ id: d.id, name: d.name.trim() || "This set", mode: d.mode, targets: d.targets, windows: d.windows });
}
