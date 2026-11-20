import { isAdultSite } from "./adultSites";
import { hostMatchesDomain } from "./hosts";
import type { DayWindow } from "./schedule";
import { type Instant, type Millis, minutes, seconds } from "./time";

/** Something a block set can block. */
export type Target =
  /** [domain] and all of its subdomains (reddit.com covers old.reddit.com). */
  | { readonly kind: "website"; readonly domain: string }
  /** Every site on the adult-site list. Acts as one target, so soft-block limits are shared across all of them. */
  | { readonly kind: "adult" }
  /**
   * "All targets of the set together" in usage tracking when the set's limits are shared
   * (limitScope "wholeSet"). Never stored in a set's targets.
   */
  | { readonly kind: "wholeSet" };

export const ADULT_SITES: Target = { kind: "adult" };
export const WHOLE_SET: Target = { kind: "wholeSet" };

export function website(domain: string): Target {
  if (domain.trim() === "" || domain !== domain.toLowerCase()) {
    throw new RangeError(`domain must be lowercase and non-blank: ${domain}`);
  }
  return { kind: "website", domain };
}

/** Stable text form, for keys and set comparisons: "web:reddit.com", "adult", "set". */
export function targetKey(t: Target): string {
  switch (t.kind) {
    case "website": return `web:${t.domain}`;
    case "adult": return "adult";
    case "wholeSet": return "set";
  }
}

export function targetFromKey(key: string): Target {
  if (key.startsWith("web:")) return website(key.slice(4));
  if (key === "adult") return ADULT_SITES;
  if (key === "set") return WHOLE_SET;
  throw new Error(`Unknown target: ${key}`);
}

/** Whether [host] (the site on screen) is covered by [t]. */
export function targetMatches(t: Target, host: string): boolean {
  switch (t.kind) {
    case "website": return hostMatchesDomain(host, t.domain);
    case "adult": return isAdultSite(host);
    case "wholeSet": return false; // resolved against the set's targets by the engine
  }
}

/**
 * hard: no way in. soft: get in with a wait and limits. reminder: never blocks; just shows
 * "N minutes so far" banners every reminderInterval of use.
 */
export type BlockMode = "hard" | "soft" | "reminder";

/** Higher = stricter; moving to a lower rank is a loosening change. */
export function strictness(mode: BlockMode): number {
  return mode === "hard" ? 2 : mode === "soft" ? 1 : 0;
}

/** Default usage reminder interval for new reminder sets. */
export const DEFAULT_REMINDER_INTERVAL: Millis = minutes(15);

/** Whether soft limits (opens, time) count per site or across the whole set together. */
export type LimitScope = "eachSite" | "wholeSet";

/**
 * Soft block restrictions. Every limit is optional (null = unlimited); any combination is allowed.
 * They apply to each site separately (unless shared) and reset each window occurrence.
 */
export interface SoftLimits {
  /** How long the Continue button stays disabled on the block page. Restarts if you leave the page. */
  readonly unlockDelay: Millis;
  /** Max opens per window occurrence. */
  readonly maxOpens: number | null;
  /** Max length of one open. Each open starts fresh at this value. */
  readonly perOpenLimit: Millis | null;
  /** Max total time per window occurrence, across all opens. */
  readonly totalLimit: Millis | null;
  /** Returning to the site within this time continues the same open instead of starting a new one. */
  readonly graceTime: Millis;
  /** Warn at 10 min and 1 min of totalLimit left. */
  readonly timeWarnings: boolean;
  /**
   * Show "N minutes so far" every this much use in the window. Optional for soft sets; reminder
   * sets always remind (falling back to DEFAULT_REMINDER_INTERVAL).
   */
  readonly reminderInterval: Millis | null;
}

export const DEFAULT_SOFT_LIMITS: SoftLimits = {
  unlockDelay: 0,
  maxOpens: null,
  perOpenLimit: null,
  totalLimit: null,
  graceTime: seconds(15),
  timeWarnings: true,
  reminderInterval: null,
};

export function softLimits(fields: Partial<SoftLimits> = {}): SoftLimits {
  const l = { ...DEFAULT_SOFT_LIMITS, ...fields };
  check(l.unlockDelay >= 0 && l.graceTime >= 0, "unlockDelay and graceTime can't be negative");
  check(l.maxOpens === null || (Number.isInteger(l.maxOpens) && l.maxOpens > 0), "maxOpens must be positive");
  check(l.perOpenLimit === null || l.perOpenLimit > 0, "perOpenLimit must be positive");
  check(l.totalLimit === null || l.totalLimit > 0, "totalLimit must be positive");
  check(l.reminderInterval === null || l.reminderInterval > 0, "reminderInterval must be positive");
  return l;
}

/** Barriers against turning a block set off on impulse. All configurable. */
export interface ProtectionSettings {
  /** How long an emergency pause lasts. */
  readonly suspensionDuration: Millis;
  /** Max pauses per window occurrence; null = unlimited. */
  readonly maxSuspensions: number | null;
  /** Wait after a pause ends before another is allowed. */
  readonly suspensionCooldown: Millis;
  /** Cooling-off: wait before turning off or a loosening edit takes effect. */
  readonly changeWait: Millis;
}

export const DEFAULT_PROTECTION: ProtectionSettings = {
  suspensionDuration: minutes(1),
  maxSuspensions: 3,
  suspensionCooldown: seconds(30),
  changeWait: minutes(5),
};

export function protectionSettings(fields: Partial<ProtectionSettings> = {}): ProtectionSettings {
  const p = { ...DEFAULT_PROTECTION, ...fields };
  check(p.suspensionDuration > 0, "suspensionDuration must be positive");
  check(p.maxSuspensions === null || (Number.isInteger(p.maxSuspensions) && p.maxSuspensions >= 0), "maxSuspensions can't be negative");
  check(p.suspensionCooldown >= 0 && p.changeWait >= 0, "waits can't be negative");
  return p;
}

export interface BlockSet {
  readonly id: string;
  readonly name: string;
  readonly mode: BlockMode;
  /** No duplicates (by targetKey). */
  readonly targets: readonly Target[];
  /** The weekly schedule as stored; use scheduleOf(set.windows) for the logic. */
  readonly windows: readonly DayWindow[];
  readonly softLimits: SoftLimits;
  readonly limitScope: LimitScope;
  readonly protection: ProtectionSettings;
  /** Motivational message shown on the block page. */
  readonly message: string;
  /** CSS color, e.g. "#5c6bc0". */
  readonly color: string;
  /** See pin.ts. Null = no PIN (actions just ask "Are you sure?"). */
  readonly pinHash: string | null;
  readonly enabled: boolean;
  /** While now is before this, the whole set is ignored (emergency pause). */
  readonly suspendedUntil: Instant | null;
}

export const DEFAULT_COLOR = "#5c6bc0";

type Required = "id" | "name" | "mode" | "targets" | "windows";

/** A block set with defaults for everything optional. */
export function blockSet(fields: Pick<BlockSet, Required> & Partial<Omit<BlockSet, Required>>): BlockSet {
  return {
    softLimits: DEFAULT_SOFT_LIMITS,
    limitScope: "eachSite",
    protection: DEFAULT_PROTECTION,
    message: "",
    color: DEFAULT_COLOR,
    pinHash: null,
    enabled: true,
    suspendedUntil: null,
    ...fields,
  };
}

export function isSuspended(set: BlockSet, now: Instant): boolean {
  return set.suspendedUntil !== null && set.suspendedUntil > now;
}

/** Whether [host] is one of this set's targets. */
export function setMatches(set: BlockSet, host: string): boolean {
  return set.targets.some((t) => targetMatches(t, host));
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(message);
}
