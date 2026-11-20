import { ALLOW, type Blocker, type Decision, type Gate, type OpenCount } from "./decision";
import {
  type BlockSet, type SoftLimits, type Target, DEFAULT_REMINDER_INTERVAL, WHOLE_SET,
  isSuspended, setMatches, targetKey, targetMatches,
} from "./model";
import { type WindowOccurrence, scheduleOf } from "./schedule";
import { type Instant, type Millis, type Zone, minutes } from "./time";

/** The current soft-block open. [leftAt] is set while the user is away from the site (grace period). */
export interface OpenSession {
  readonly used: Millis;
  readonly leftAt: Instant | null;
}

/** One open, for the usage history. [used] is on-screen time, so it excludes grace gaps. */
export interface OpenRecord {
  readonly startedAt: Instant;
  readonly used: Millis;
}

/**
 * Usage of one target by one set in one window occurrence. Tracking per occurrence means it all
 * resets when the next occurrence starts.
 */
export interface UsageEntry {
  readonly setId: string;
  readonly target: Target;
  readonly occurrenceKey: string;
  readonly opensUsed: number;
  readonly timeUsed: Millis;
  readonly session: OpenSession | null;
  /** Every open this window, oldest first. The last one is the current open if [session] is live. */
  readonly opens: readonly OpenRecord[];
  /** Time-warning thresholds (minutes left) already sent this window. */
  readonly warned: readonly number[];
  /** How many "N minutes so far" reminders were shown this window. */
  readonly remindersSent: number;
}

export function usageKey(setId: string, target: Target, occurrenceKey: string): string {
  return `${setId}|${targetKey(target)}|${occurrenceKey}`;
}

/** "You've used [target] for [used] so far" for one set. */
export interface UsageReminder {
  readonly setId: string;
  readonly setName: string;
  readonly target: Target;
  readonly used: Millis;
}

/** "[target] has [threshold] of total time left" for one soft block set. */
export interface TimeWarning {
  readonly setId: string;
  readonly setName: string;
  readonly target: Target;
  readonly threshold: Millis;
}

/** Minutes-left marks for TimeWarnings. */
export const WARNING_MINUTES = [10, 1] as const;

/** What the engine needs to resume after the service worker restarts. Plain JSON. */
export interface EngineSnapshot {
  readonly usage: Readonly<Record<string, UsageEntry>>;
  /** Host on screen, or null. */
  readonly foreground: string | null;
  readonly lastAccrualAt: Instant | null;
}

interface ActivePair {
  readonly set: BlockSet;
  readonly target: Target;
  readonly occurrence: WindowOccurrence;
  readonly key: string;
}

/**
 * Decides whether the site on screen is allowed, and does the screen-time accounting.
 *
 * Driven by events from the browser layer:
 *  - onForegroundChanged whenever the site in use changes (null = browser not focused, idle,
 *    asleep, or a page that isn't a website).
 *  - tick when nextEvaluationAt is reached, so limits and window boundaries take effect on time.
 *  - unlock when the user presses Continue on a soft block page. The unlock delay countdown is
 *    enforced by the UI.
 *
 * Rules:
 *  - Most restrictive wins: any hard block (including an exhausted soft block) beats a soft gate,
 *    and a soft gate beats an open session. With several soft sets, all must be unlocked.
 *  - Time is only counted while the site is on screen inside an unlocked open, inside an active,
 *    enabled, non-paused window. It counts against every soft set that matches the site.
 *  - Leaving and returning within the set's grace time continues the same open.
 */
export class BlockEngine {
  private _sets: readonly BlockSet[];
  private readonly _usage: Map<string, UsageEntry>;
  private _foreground: string | null;
  private lastAccrualAt: Instant | null;

  constructor(private readonly zone: Zone, sets: readonly BlockSet[] = [], snapshot?: Partial<EngineSnapshot>) {
    this._sets = sets;
    this._usage = new Map(Object.entries(snapshot?.usage ?? {}));
    this._foreground = snapshot?.foreground ?? null;
    this.lastAccrualAt = snapshot?.lastAccrualAt ?? null;
  }

  get sets(): readonly BlockSet[] {
    return this._sets;
  }

  get usage(): Record<string, UsageEntry> {
    return Object.fromEntries(this._usage);
  }

  get foreground(): string | null {
    return this._foreground;
  }

  snapshot(): EngineSnapshot {
    return { usage: this.usage, foreground: this._foreground, lastAccrualAt: this.lastAccrualAt };
  }

  updateSets(newSets: readonly BlockSet[], now: Instant): Decision {
    this.accrue(now);
    this._sets = newSets;
    this.prune(now);
    return this.evaluate(this._foreground, now);
  }

  onForegroundChanged(host: string | null, now: Instant): Decision {
    this.accrue(now);
    const old = this._foreground;
    this._foreground = host;
    for (const [key, u] of [...this._usage]) {
      const session = u.session;
      if (!session) continue;
      const set = this.setById(u.setId);
      if (!set) continue;
      const wasOn = old !== null && keyMatches(set, u, old);
      const isOn = host !== null && keyMatches(set, u, host);
      if (wasOn && !isOn) {
        this._usage.set(key, { ...u, session: { ...session, leftAt: now } });
      } else if (isOn && session.leftAt !== null) {
        const live = liveSession(u, set.softLimits, now) !== null;
        this._usage.set(key, { ...u, session: live ? { ...session, leftAt: null } : null });
      }
    }
    return this.evaluate(host, now);
  }

  tick(now: Instant): Decision {
    this.accrue(now);
    this.prune(now);
    return this.evaluate(this._foreground, now);
  }

  /** User pressed Continue on the soft block page. Starts a new open for every gate. */
  unlock(now: Instant): Decision {
    this.accrue(now);
    const fg = this._foreground;
    if (fg === null) return ALLOW;
    const decision = this.evaluate(fg, now);
    if (decision.type !== "softGate") return decision;
    for (const pair of this.activePairs(fg, now)) {
      if (pair.set.mode !== "soft") continue;
      const u = this._usage.get(pair.key) ?? emptyUsage(pair);
      if (liveSession(u, pair.set.softLimits, now) !== null) continue;
      this._usage.set(pair.key, {
        ...u,
        opensUsed: u.opensUsed + 1,
        session: { used: 0, leftAt: null },
        opens: [...u.opens, { startedAt: now, used: 0 }],
      });
    }
    return this.evaluate(fg, now);
  }

  /** Read-only decision for [host] at [now]. */
  evaluate(host: string | null, now: Instant): Decision {
    if (host === null) return ALLOW;
    const blockers: Blocker[] = [];
    const gates: { gate: Gate; delay: Millis }[] = [];
    const sessions: (Millis | null)[] = [];

    for (const pair of this.activePairs(host, now)) {
      const set = pair.set;
      const until = pair.occurrence.end;
      if (set.mode === "reminder") continue; // never blocks
      if (set.mode === "hard") {
        blockers.push({ setId: set.id, setName: set.name, target: pair.target, reason: { type: "scheduled" }, until });
        continue;
      }
      const l = set.softLimits;
      const u = this._usage.get(pair.key) ?? emptyUsage(pair);
      const session = liveSession(u, l, now);
      if (l.totalLimit !== null && u.timeUsed >= l.totalLimit) {
        blockers.push({ setId: set.id, setName: set.name, target: pair.target, reason: { type: "totalTimeExceeded", limit: l.totalLimit }, until });
      } else if (session !== null) {
        const left = [
          l.perOpenLimit === null ? null : l.perOpenLimit - session.used,
          l.totalLimit === null ? null : l.totalLimit - u.timeUsed,
        ].filter((x): x is number => x !== null);
        sessions.push(left.length > 0 ? Math.min(...left) : null);
      } else if (l.maxOpens !== null && u.opensUsed >= l.maxOpens) {
        blockers.push({ setId: set.id, setName: set.name, target: pair.target, reason: { type: "opensExhausted", maxOpens: l.maxOpens }, until });
      } else {
        gates.push({
          gate: {
            setId: set.id, setName: set.name, target: pair.target,
            opensUsed: u.opensUsed, maxOpens: l.maxOpens, timeUsed: u.timeUsed, totalLimit: l.totalLimit,
          },
          delay: l.unlockDelay,
        });
      }
    }

    if (blockers.length > 0) {
      return { type: "blocked", blockers: [...blockers].sort((a, b) => b.until - a.until) };
    }
    if (gates.length > 0) {
      const opensLeft = (g: Gate) => (g.maxOpens === null ? Infinity : g.maxOpens - g.opensUsed);
      const sorted = gates.map((g) => g.gate).sort((a, b) => opensLeft(a) - opensLeft(b));
      const first = sorted[0]!;
      const opens: OpenCount | null = first.maxOpens === null ? null : { used: first.opensUsed, max: first.maxOpens };
      return { type: "softGate", gates: sorted, unlockDelay: Math.max(...gates.map((g) => g.delay)), opens };
    }
    if (sessions.length > 0) {
      const finite = sessions.filter((x): x is number => x !== null);
      return { type: "inSession", remaining: finite.length > 0 ? Math.min(...finite) : null };
    }
    return ALLOW;
  }

  /** When tick should be called next, or null if nothing will change on its own. */
  nextEvaluationAt(now: Instant): Instant | null {
    const candidates: Instant[] = [];
    for (const set of this._sets) {
      if (!set.enabled) continue;
      const change = scheduleOf(set.windows).nextChangeInstant(now, this.zone);
      if (change !== null) candidates.push(change);
      if (set.suspendedUntil !== null && set.suspendedUntil > now) candidates.push(set.suspendedUntil);
    }
    const d = this.evaluate(this._foreground, now);
    if (d.type === "inSession" && d.remaining !== null) candidates.push(now + d.remaining);
    candidates.push(...this.upcomingWarnings(now), ...this.upcomingReminders(now));
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  /**
   * Time warnings that are due now for the site on screen; each is returned once per window.
   * Call after tick / onForegroundChanged. If several are due at once, only the most urgent is
   * returned (the others are marked as sent).
   */
  collectTimeWarnings(now: Instant): TimeWarning[] {
    const fg = this._foreground;
    if (fg === null || this.evaluate(fg, now).type !== "inSession") return [];
    const due: TimeWarning[] = [];
    for (const pair of this.warnablePairs(fg, now)) {
      const u = this._usage.get(pair.key)!;
      const total = pair.set.softLimits.totalLimit!;
      const left = total - u.timeUsed;
      const thresholds = WARNING_MINUTES.filter((m) => !u.warned.includes(m) && minutes(m) < total && left <= minutes(m));
      if (thresholds.length === 0 || left <= 0) continue;
      this._usage.set(pair.key, { ...u, warned: [...u.warned, ...thresholds] });
      due.push({ setId: pair.set.id, setName: pair.set.name, target: pair.target, threshold: minutes(Math.min(...thresholds)) });
    }
    return due;
  }

  /**
   * "N minutes so far" reminders due now for the site on screen, at most one per set per call.
   * Each multiple of the interval is reminded once per window.
   */
  collectReminders(now: Instant): UsageReminder[] {
    const fg = this._foreground;
    if (fg === null) return [];
    const due: UsageReminder[] = [];
    for (const { pair, interval } of this.remindablePairs(fg, now)) {
      const u = this._usage.get(pair.key) ?? emptyUsage(pair);
      const reached = Math.floor(u.timeUsed / interval);
      if (reached <= u.remindersSent) continue;
      this._usage.set(pair.key, { ...u, remindersSent: reached });
      due.push({ setId: pair.set.id, setName: pair.set.name, target: pair.target, used: interval * reached });
    }
    return due;
  }

  private upcomingReminders(now: Instant): Instant[] {
    const fg = this._foreground;
    if (fg === null) return [];
    return this.remindablePairs(fg, now)
      .map(({ pair, interval }) => {
        const u = this._usage.get(pair.key) ?? emptyUsage(pair);
        return now + interval * (u.remindersSent + 1) - u.timeUsed;
      })
      .filter((t) => t > now);
  }

  /** Pairs on screen that are being counted right now and have reminders, with their interval. */
  private remindablePairs(fg: string, now: Instant): { pair: ActivePair; interval: Millis }[] {
    const d = this.evaluate(fg, now);
    if (d.type === "blocked" || d.type === "softGate") return [];
    const result: { pair: ActivePair; interval: Millis }[] = [];
    for (const pair of this.activePairs(fg, now)) {
      const l = pair.set.softLimits;
      if (pair.set.mode === "reminder") {
        result.push({ pair, interval: l.reminderInterval ?? DEFAULT_REMINDER_INTERVAL });
      } else if (pair.set.mode === "soft" && l.reminderInterval !== null) {
        const u = this._usage.get(pair.key);
        if (u && liveSession(u, l, now) !== null) result.push({ pair, interval: l.reminderInterval });
      }
    }
    return result;
  }

  /** When each pending warning for the site on screen will be due, assuming it stays on screen. */
  private upcomingWarnings(now: Instant): Instant[] {
    const fg = this._foreground;
    if (fg === null || this.evaluate(fg, now).type !== "inSession") return [];
    return this.warnablePairs(fg, now).flatMap((pair) => {
      const u = this._usage.get(pair.key)!;
      const total = pair.set.softLimits.totalLimit!;
      const left = total - u.timeUsed;
      return WARNING_MINUTES
        .filter((m) => !u.warned.includes(m) && minutes(m) < total && left > minutes(m))
        .map((m) => now + left - minutes(m));
    });
  }

  /** Soft pairs on screen with a live open, a total limit, and warnings turned on. */
  private warnablePairs(fg: string, now: Instant): ActivePair[] {
    return this.activePairs(fg, now).filter((pair) => {
      const l = pair.set.softLimits;
      const u = this._usage.get(pair.key);
      return pair.set.mode === "soft" && l.timeWarnings && l.totalLimit !== null && u !== undefined && liveSession(u, l, now) !== null;
    });
  }

  private activePairs(host: string, now: Instant): ActivePair[] {
    const pairs: ActivePair[] = [];
    for (const set of this._sets) {
      if (!set.enabled || isSuspended(set, now)) continue;
      const occurrence = scheduleOf(set.windows).occurrenceAtInstant(now, this.zone);
      if (!occurrence) continue;
      if (set.limitScope === "wholeSet") {
        // One shared count for the whole set, whichever of its sites is on screen.
        if (setMatches(set, host)) pairs.push(pair(set, WHOLE_SET, occurrence));
      } else {
        for (const target of set.targets) {
          if (targetMatches(target, host)) pairs.push(pair(set, target, occurrence));
        }
      }
    }
    return pairs;
  }

  /** Adds on-screen time since the last event to every open session the site on screen is using. */
  private accrue(now: Instant): void {
    const from = this.lastAccrualAt;
    this.lastAccrualAt = now;
    const fg = this._foreground;
    if (fg === null || from === null || now <= from) return;
    // Only time actually spent on the site counts — not time on a block page.
    const d = this.evaluate(fg, from);
    if (d.type === "blocked" || d.type === "softGate") return;
    const elapsed = now - from;
    for (const pair of this.activePairs(fg, from)) {
      if (pair.set.mode === "reminder") {
        const u = this._usage.get(pair.key) ?? emptyUsage(pair);
        this._usage.set(pair.key, { ...u, timeUsed: u.timeUsed + elapsed });
        continue;
      }
      if (pair.set.mode !== "soft") continue;
      const u = this._usage.get(pair.key);
      if (!u) continue;
      const session = liveSession(u, pair.set.softLimits, from);
      if (!session) continue;
      const last = u.opens[u.opens.length - 1];
      this._usage.set(pair.key, {
        ...u,
        timeUsed: u.timeUsed + elapsed,
        session: { ...session, used: session.used + elapsed },
        opens: [...u.opens.slice(0, -1), last ? { ...last, used: last.used + elapsed } : { startedAt: from, used: elapsed }],
      });
    }
  }

  /** Drops usage from past occurrences and deleted sets. */
  private prune(now: Instant): void {
    const current = new Map(this._sets.map((s) => [s.id, scheduleOf(s.windows).occurrenceAtInstant(now, this.zone)?.key]));
    for (const [key, u] of [...this._usage]) {
      if (current.get(u.setId) !== u.occurrenceKey) this._usage.delete(key);
    }
  }

  private setById(id: string): BlockSet | undefined {
    return this._sets.find((s) => s.id === id);
  }
}

function pair(set: BlockSet, target: Target, occurrence: WindowOccurrence): ActivePair {
  return { set, target, occurrence, key: usageKey(set.id, target, occurrence.key) };
}

function emptyUsage(p: ActivePair): UsageEntry {
  return {
    setId: p.set.id, target: p.target, occurrenceKey: p.occurrence.key,
    opensUsed: 0, timeUsed: 0, session: null, opens: [], warned: [], remindersSent: 0,
  };
}

/** The open still counts if the user hasn't been away longer than the grace time and it has time left. */
function liveSession(u: UsageEntry, limits: SoftLimits, now: Instant): OpenSession | null {
  const s = u.session;
  if (!s) return null;
  if (s.leftAt !== null && now - s.leftAt > limits.graceTime) return null;
  if (limits.perOpenLimit !== null && s.used >= limits.perOpenLimit) return null;
  return s;
}

/** Whether a usage entry covers [host] — for shared limits, any of the set's sites. */
function keyMatches(set: BlockSet, u: UsageEntry, host: string): boolean {
  return u.target.kind === "wholeSet" ? setMatches(set, host) : targetMatches(u.target, host);
}
