import type { AppState } from "../core/appState";
import { type Decision, describeBlocker, formatDuration, gateTimeLeft } from "../core/decision";
import type { TimeWarning, UsageReminder } from "../core/engine";
import { setById, streakOf } from "../core/stateActions";
import { HOUR, MINUTE, type Millis } from "../core/time";
import type { BlockPageModel, ContentMessage, SoftGateInfo } from "../shared/messages";

// Turning engine results into what the block page and banner show.

const FALLBACK_COLOR = "#9aaaff";

export function blockPageModel(decision: Decision, host: string, state: AppState): BlockPageModel {
  const base = { host, setName: "", color: FALLBACK_COLOR, message: "", streakDays: 0, reasons: [], soft: null };
  if (decision.type === "blocked") {
    const primary = decision.blockers[0]!;
    const set = setById(state, primary.setId);
    return {
      ...base,
      status: "blocked",
      setName: primary.setName,
      color: set?.color ?? FALLBACK_COLOR,
      message: set?.message ?? "",
      streakDays: streakOf(state, primary.setId).days,
      reasons: [...new Set(decision.blockers.map(describeBlocker))],
    };
  }
  if (decision.type === "softGate") {
    const gate = decision.gates[0]!;
    const set = setById(state, gate.setId);
    const soft: SoftGateInfo = {
      unlockDelay: decision.unlockDelay,
      opensUsed: decision.opens?.used ?? gate.opensUsed,
      maxOpens: decision.opens?.max ?? null,
      timeLeft: gateTimeLeft(gate),
      totalLimit: gate.totalLimit,
      // Total time is shown as "X of Y left", so only the per-open limit here.
      limitsSummary: set?.softLimits.perOpenLimit ? `${formatDuration(set.softLimits.perOpenLimit)} per open` : "",
    };
    return {
      ...base,
      status: "softGate",
      setName: gate.setName,
      color: set?.color ?? FALLBACK_COLOR,
      message: set?.message ?? "",
      streakDays: streakOf(state, gate.setId).days,
      // With several soft sets, Continue uses an open from each — list them so that's never a surprise.
      reasons: decision.gates.length > 1
        ? ["Continue uses an open from each:", ...decision.gates.map((g) =>
            `• ${g.setName}: ${g.maxOpens === null ? "unlimited opens" : `${g.maxOpens - g.opensUsed} of ${g.maxOpens} opens left`}`)]
        : [],
      soft,
    };
  }
  return { ...base, status: "allowed" };
}

/** The banner for what's due now; a time warning beats a reminder due at the same moment. */
export function bannerFor(
  warnings: readonly TimeWarning[],
  reminders: readonly UsageReminder[],
  host: string,
  state: AppState,
): ContentMessage | null {
  const colorOf = (id: string) => setById(state, id)?.color ?? FALLBACK_COLOR;
  const warning = [...warnings].sort((a, b) => a.threshold - b.threshold)[0];
  if (warning) {
    const m = Math.round(warning.threshold / MINUTE);
    return { type: "banner", text: `${host} · ${m === 1 ? "1 minute" : `${m} minutes`} left`, setName: warning.setName, color: colorOf(warning.setId) };
  }
  const reminder = [...reminders].sort((a, b) => b.used - a.used)[0];
  if (reminder) {
    const name = reminder.target.kind === "wholeSet" ? reminder.setName : host;
    return { type: "banner", text: `${name} · ${soFar(reminder.used)} so far`, setName: reminder.setName, color: colorOf(reminder.setId) };
  }
  return null;
}

/** "15 minutes", "1 hour", "1 h 15 min". */
export function soFar(d: Millis): string {
  const h = Math.floor(d / HOUR);
  const m = Math.floor(d / MINUTE) % 60;
  if (h === 0) return m === 1 ? "1 minute" : `${m} minutes`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} h ${m} min`;
}
