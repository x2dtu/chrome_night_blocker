import { useState } from "preact/hooks";
import { type DayWindow, MINUTES_PER_DAY } from "../core/schedule";
import { ALL_DAYS, type DayOfWeek, clockLabel, dayName } from "../core/time";
import { type WindowGroup, groupToWindows, groupWindows, windowGroup } from "../core/windowGroups";
import { Dialog, Hint, WeekBars, WindowGroupRow } from "../ui/components";

const WEEKDAYS: DayOfWeek[] = [1, 2, 3, 4, 5];
const SCHOOL_NIGHTS: DayOfWeek[] = [0, 1, 2, 3, 4];

const key = (w: DayWindow) => `${w.day}:${w.startMinute}:${w.endMinute}`;
const without = (windows: readonly DayWindow[], g: WindowGroup) => {
  const remove = new Set(groupToWindows(g).map(key));
  return windows.filter((w) => !remove.has(key(w)));
};

/** Bars + grouped time ranges (click to edit) + "add" dialog. */
export function ScheduleEditor({ windows, color, onChange }: { windows: readonly DayWindow[]; color: string; onChange: (w: DayWindow[]) => void }) {
  const [editing, setEditing] = useState<WindowGroup | "new" | null>(null);
  const groups = groupWindows(windows);
  return (
    <div class="stack">
      <WeekBars windows={windows} color={color} />
      {groups.map((g) => (
        <WindowGroupRow group={g} color={color} onEdit={() => setEditing(g)} onRemove={() => onChange(without(windows, g))} />
      ))}
      {groups.length === 0 && <Hint>No times yet. Add when this block set should be active.</Hint>}
      <button type="button" class="tonal" onClick={() => setEditing("new")}>+ Add time window</button>
      {editing && (
        <WindowDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(g) => {
            const base = editing === "new" ? [...windows] : without(windows, editing);
            onChange([...base, ...groupToWindows(g)]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

const toInput = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromInput = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Pick days and start/end times. If the end is at or before the start, it runs past midnight. */
function WindowDialog({ initial, onSave, onClose }: { initial: WindowGroup | null; onSave: (g: WindowGroup) => void; onClose: () => void }) {
  const [days, setDays] = useState<DayOfWeek[]>(initial ? [...initial.days] : []);
  const [start, setStart] = useState(initial?.start ?? 22 * 60);
  const [end, setEnd] = useState(initial ? (initial.end === MINUTES_PER_DAY ? 0 : initial.end) : 7 * 60);
  const toggle = (d: DayOfWeek) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  const same = (a: DayOfWeek[]) => a.length === days.length && a.every((d) => days.includes(d));
  return (
    <Dialog
      title={initial ? "Edit time window" : "Add time window"}
      onClose={onClose}
      actions={<>
        <button type="button" class="text" onClick={onClose}>Cancel</button>
        <button type="button" class="text strong" disabled={days.length === 0}
          onClick={() => onSave(windowGroup(days, start, end === 0 ? MINUTES_PER_DAY : end))}>Save</button>
      </>}
    >
      <h3>Days</h3>
      <div class="chips">
        {ALL_DAYS.map((d) => (
          <button type="button" class={`chip ${days.includes(d) ? "selected" : ""}`} aria-pressed={days.includes(d)} onClick={() => toggle(d)}>{dayName(d)}</button>
        ))}
      </div>
      <div class="chips">
        <button type="button" class={`chip assist ${same([...ALL_DAYS]) ? "selected" : ""}`} onClick={() => setDays([...ALL_DAYS])}>Every day</button>
        <button type="button" class={`chip assist ${same(WEEKDAYS) ? "selected" : ""}`} onClick={() => setDays(WEEKDAYS)}>Weekdays</button>
        <button type="button" class={`chip assist ${same(SCHOOL_NIGHTS) ? "selected" : ""}`} onClick={() => setDays(SCHOOL_NIGHTS)}>Sun–Thu</button>
      </div>
      <h3>Time</h3>
      <div class="row">
        <label class="field grow"><span>From</span><input type="time" value={toInput(start)} onInput={(e) => e.currentTarget.value && setStart(fromInput(e.currentTarget.value))} /></label>
        <label class="field grow"><span>To</span><input type="time" value={toInput(end)} onInput={(e) => e.currentTarget.value && setEnd(fromInput(e.currentTarget.value))} /></label>
      </div>
      <Hint>
        {end === 0 ? (start === 0 ? "All day." : "Runs until midnight.")
          : end <= start ? `Runs overnight — ends at ${clockLabel(end)} the next morning.`
          : "Same-day window."}
      </Hint>
    </Dialog>
  );
}
