import type { AppState } from "../core/appState";
import type { BlockSet } from "../core/model";
import { streakOf } from "../core/stateActions";
import { systemZone } from "../core/time";
import { ColorDot, Hint, Pill, ScreenHeader, SectionCard, SiteIcon } from "../ui/components";
import { navigate, useNow } from "../ui/hooks";
import { type SetStatus, headerSubtitle, modeLabel, stateLabel, statusOf } from "../ui/status";

const MAX_TEASER = 7;

export function ListScreen({ state }: { state: AppState }) {
  const now = useNow();
  const zone = systemZone();
  const statuses = new Map(state.sets.map((s) => [s.id, statusOf(s, state, now, zone)]));
  const active = [...statuses.values()].filter((s) => s.state === "active").length;
  return (
    <>
      <ScreenHeader title="Night Blocker" subtitle={headerSubtitle(state.sets.length, active)} />
      {state.sets.length === 0 && (
        <SectionCard title="Get started">
          <Hint>
            A block set is a group of websites plus a schedule. Start with bedtime — say, social sites from 11:30 PM
            to 8 AM — then add more for other parts of your day.
          </Hint>
        </SectionCard>
      )}
      {state.sets.map((set) => (
        <SetCard set={set} streak={streakOf(state, set.id).days} status={statuses.get(set.id)!} />
      ))}
      <button type="button" class="primary wide" onClick={() => navigate("/new")}>+ New block set</button>
    </>
  );
}

function SetCard({ set, streak, status }: { set: BlockSet; streak: number; status: SetStatus }) {
  return (
    <button type="button" class="card set-card" style={{ "--accent": set.color }} onClick={() => navigate(`/set/${encodeURIComponent(set.id)}`)}>
      <span class="row">
        <ColorDot color={set.color} size={14} />
        <span class="set-name grow">{set.name}</span>
        <Pill text={modeLabel(set.mode)} color={set.color} />
      </span>
      <span class="row">
        <Pill text={stateLabel(status.state, set.mode)} color={`var(--state-${status.state})`} />
        <span class="muted">{status.text}</span>
      </span>
      {status.pending && <span class="pending">{status.pending}</span>}
      <span class="row">
        {set.targets.slice(0, MAX_TEASER).map((t) => <SiteIcon target={t} size={30} />)}
        {set.targets.length > MAX_TEASER && <span class="hint">+{set.targets.length - MAX_TEASER}</span>}
        <span class="grow" />
        {streak > 0 && set.mode !== "reminder" && <span class="streak">🔥 {streak}-day streak</span>}
      </span>
    </button>
  );
}
