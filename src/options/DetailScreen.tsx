import { useState } from "preact/hooks";
import type { AppState } from "../core/appState";
import { formatDuration } from "../core/decision";
import { DEFAULT_REMINDER_INTERVAL } from "../core/model";
import { setById, streakOf } from "../core/stateActions";
import { checkSuspension } from "../core/suspension";
import { systemZone } from "../core/time";
import { groupWindows } from "../core/windowGroups";
import { ConfirmDialog, Hint, Pill, ScreenHeader, SectionCard, SiteIcon, WeekBars, WindowGroupRow } from "../ui/components";
import { formatTime, targetLabel } from "../ui/format";
import { act, navigate, useNow } from "../ui/hooks";
import { limitRows, modeLabel, pauseText, stateLabel, statusOf } from "../ui/status";
import { usageRows } from "../ui/usage";
import { outcomeText, useProtectedAction } from "./actions";
import { useNotify } from "./app";

export function DetailScreen({ state, setId }: { state: AppState; setId: string }) {
  const now = useNow(1000);
  const zone = systemZone();
  const notify = useNotify();
  const set = setById(state, setId);
  const [start, dialog] = useProtectedAction(!!set?.pinHash);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!set) {
    return <><ScreenHeader title="Block set not found" onBack={() => navigate("/")} /></>;
  }
  const status = statusOf(set, state, now, zone);
  const streak = streakOf(state, set.id).days;
  const pending = state.pendingChanges[set.id];
  /** A turn-off is already waiting out the cooling-off. */
  const turningOff = pending !== undefined && !pending.proposed.enabled;
  const check = checkSuspension(set, state.suspensions[set.id], now, zone);
  const usage = set.mode !== "hard" ? usageRows(set, state, now, zone) : null;
  const p = set.protection;

  const setEnabled = (enabled: boolean) => start({
    pinTitle: `Enter PIN to turn ${enabled ? "on" : "off"}`,
    confirmTitle: `Turn ${enabled ? "on" : "off"} ${set.name}?`,
    confirmText: enabled ? "It starts applying right away." : `It turns off after ${formatDuration(p.changeWait)}. You can cancel until then.`,
    request: (pin) => ({ type: "setEnabled", setId: set.id, enabled, pin }),
    onDone: (outcome) => notify(outcomeText(outcome, zone)),
  });

  return (
    <div style={{ "--accent": set.color }} class="screen">
      <ScreenHeader title={set.name} onBack={() => navigate("/")} />

      <section class="card hero">
        <div class="row">
          <Pill text={stateLabel(status.state, set.mode)} color={`var(--state-${status.state})`} />
          <Pill text={modeLabel(set.mode)} color={set.color} />
        </div>
        <p class="hero-text">{status.text}</p>
        {set.mode !== "reminder" && (
          <p class={streak > 0 ? "streak" : "hint"}>{streak > 0 ? `🔥 ${streak}-day streak` : "No streak yet — get through a full window without pausing."}</p>
        )}
        {set.message && <p>“{set.message}”</p>}
      </section>

      {pending && (
        <section class="card notice">
          <p>
            {pending.proposed.enabled ? "Your change (it blocks less)" : "Turning this block set off"} takes effect at {formatTime(pending.appliesAt, zone)}.
          </p>
          <button type="button" class="outline" onClick={async () => {
            const r = await act({ type: "cancelPending", setId: set.id });
            notify(r.ok ? "Cancelled — nothing changes" : r.error);
          }}>Cancel — keep it as is</button>
        </section>
      )}

      <SectionCard title="Schedule">
        <WeekBars windows={set.windows} color={set.color} />
        {groupWindows(set.windows).map((g) => <WindowGroupRow group={g} color={set.color} />)}
      </SectionCard>

      <SectionCard title="Blocks" subtitle={set.targets.length === 1 ? "1 website" : `${set.targets.length} websites`}>
        {set.targets.map((t) => (
          <div class="row"><SiteIcon target={t} size={36} /><span>{targetLabel(t)}</span></div>
        ))}
      </SectionCard>

      {set.mode !== "hard" && (
        <SectionCard
          title="This window's usage"
          subtitle={usage ? `Since ${formatTime(usage.since, zone)} · resets when the next window starts` : undefined}
          info={"Time only counts while the site is in the focused tab after you press Continue — not on the block page, " +
            "while the browser is in the background, or while the laptop sleeps.\n\n" +
            "Idle (no keyboard or mouse for 3 minutes, unless the tab is playing audio) or a locked screen: an open with a " +
            "time limit keeps counting; one without ends after the grace period.\n\n" +
            "If a site is in more than one soft block set, time and opens count against each."}
        >
          {!usage ? <Hint>Usage shows up here while the block set is on.</Hint> : usage.rows.map((row) => (
            <div class="usage">
              <div class="row">
                {row.domain ? <SiteIcon target={{ kind: "website", domain: row.domain }} size={32} /> : <SiteIcon target={{ kind: "wholeSet" }} size={32} />}
                <div class="grow"><div>{row.label}</div><p class="hint">{row.summary}</p></div>
              </div>
              {row.opens.map((o) => <p class={`open ${o.current ? "current" : ""}`}>{o.text}</p>)}
            </div>
          ))}
        </SectionCard>
      )}

      {set.mode === "soft" && (
        <SectionCard title="Soft block limits" subtitle={set.limitScope === "wholeSet" ? "Shared across the whole set, reset each window" : "Per site, reset each window"}>
          {limitRows(set).map(([label, value]) => <div class="limit-row"><span>{label}</span><span>{value}</span></div>)}
        </SectionCard>
      )}
      {set.mode === "reminder" && (
        <SectionCard title="Reminders">
          <div class="limit-row"><span>Remind me every</span><span>{formatDuration(set.softLimits.reminderInterval ?? DEFAULT_REMINDER_INTERVAL)}</span></div>
          <div class="limit-row"><span>Counting</span><span>{set.limitScope === "wholeSet" ? "All sites together" : "Each site separately"}</span></div>
        </SectionCard>
      )}

      {set.mode !== "reminder" && (
        <SectionCard
          title="Emergency pause"
          info={`Pauses the whole block set for ${formatDuration(p.suspensionDuration)}, then it turns itself back on. Needs your PIN, is limited per window, and resets your streak.`}
        >
          <Hint>{pauseText(check, set, zone)}</Hint>
          <button type="button" class="tertiary wide" disabled={check.type !== "allowed"} onClick={() => start({
            pinTitle: "Enter PIN to pause",
            confirmTitle: `Pause ${set.name}?`,
            confirmText: `It stops blocking for ${formatDuration(p.suspensionDuration)} and resets your streak.`,
            request: (pin) => ({ type: "suspend", setId: set.id, pin }),
            onDone: () => notify(`Paused for ${formatDuration(p.suspensionDuration)}`),
          })}>Pause for {formatDuration(p.suspensionDuration)}</button>
        </SectionCard>
      )}

      <SectionCard title="Manage">
        <button type="button" class="outline wide" onClick={() => navigate(`/edit/${encodeURIComponent(set.id)}`)}>Edit block set</button>
        {set.enabled ? (
          <>
            <button type="button" class="outline wide" disabled={turningOff} onClick={() => setEnabled(false)}>
              {turningOff ? `Turning off at ${formatTime(pending!.appliesAt, zone)}` : "Turn off"}
            </button>
            <Hint>
              {turningOff
                ? "Already turning off — cancel it above to keep the block set on."
                : `Turning off takes effect after ${formatDuration(p.changeWait)}. You can cancel it until then.`}
            </Hint>
          </>
        ) : (
          <>
            <button type="button" class="primary wide" onClick={() => setEnabled(true)}>Turn on</button>
            <button type="button" class="outline danger wide" onClick={() => setConfirmDelete(true)}>Delete</button>
          </>
        )}
      </SectionCard>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${set.name}?`} text="This removes the block set and its streak for good." confirm="Continue"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            start({
              pinTitle: "Enter PIN to delete",
              confirmTitle: `Delete ${set.name}?`,
              confirmText: "This can't be undone.",
              request: (pin) => ({ type: "deleteSet", setId: set.id, pin }),
              onDone: () => { notify(`Deleted ${set.name}`); navigate("/"); },
            });
          }}
        />
      )}
      {dialog}
    </div>
  );
}
