import { useMemo, useState } from "preact/hooks";
import type { AppState } from "../core/appState";
import { domainFromUserInput } from "../core/hosts";
import { type BlockMode, type LimitScope, type Target, targetKey, website } from "../core/model";
import { describeOverlap, findOverlaps } from "../core/overlap";
import { setById } from "../core/stateActions";
import { systemZone } from "../core/time";
import {
  ChoiceCard, Hint, InfoButton, NumberSetting, PinDialog, PinField, ScreenHeader, SectionCard, SiteIcon, Switch, SwitchSetting,
} from "../ui/components";
import { buildSet, type Draft, draftFrom, previewSet } from "../ui/draft";
import { SET_COLORS, targetLabel } from "../ui/format";
import { act, navigate } from "../ui/hooks";
import { outcomeText } from "./actions";
import { useNotify } from "./app";
import { ScheduleEditor } from "./ScheduleEditor";

/** Phase 6 adds the adult-site list; until then the switch stays hidden. */
const ADULT_LIST_AVAILABLE = false;

/** Create ([setId] null) or edit a block set. Editing a set with a PIN asks for it first. */
export function EditorScreen({ state, setId }: { state: AppState; setId: string | null }) {
  const original = setId === null ? null : setById(state, setId) ?? null;
  const [pin, setPin] = useState<string | null>(null);
  if (setId !== null && !original) return <ScreenHeader title="Block set not found" onBack={() => navigate("/")} />;
  const back = () => navigate(original ? `/set/${encodeURIComponent(original.id)}` : "/");
  if (original?.pinHash && pin === null) {
    return (
      <>
        <ScreenHeader title="Edit block set" onBack={back} />
        <PinDialog
          title="Enter PIN to edit"
          onClose={back}
          onSubmit={async (entered) => {
            const r = await act({ type: "verifyPin", setId: original.id, pin: entered });
            if (!r.ok) return r.error;
            setPin(entered);
            return null;
          }}
        />
      </>
    );
  }
  return <Editor state={state} original={original} pin={pin ?? undefined} onBack={back} />;
}

function Editor({ state, original, pin, onBack }: { state: AppState; original: AppState["sets"][number] | null; pin?: string; onBack: () => void }) {
  const notify = useNotify();
  const [d, setDraft] = useState<Draft>(() => draftFrom(original));
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  const update = (fields: Partial<Draft>) => setDraft((old) => ({ ...old, ...fields }));
  const others = state.sets.filter((s) => s.id !== d.id);
  const overlaps = useMemo(() => findOverlaps(previewSet(d), others), [d.targets, d.windows, state.sets]);
  const shared = d.limitScope === "wholeSet";

  const save = async () => {
    const built = buildSet(d, original);
    if (!built.ok) return setErrors(built.errors);
    setErrors([]);
    setSaving(true);
    const result = original
      ? await act({ type: "editSet", set: built.set, pin })
      : await act({ type: "createSet", set: built.set, pin: built.pin });
    setSaving(false);
    if (!result.ok) return setErrors([result.error]);
    notify(original ? outcomeText(result.outcome, systemZone()) : `Created ${built.set.name}`);
    navigate(`/set/${encodeURIComponent(built.set.id)}`);
  };

  return (
    <div class="screen" style={{ "--accent": d.color }}>
      <ScreenHeader title={original ? "Edit block set" : "New block set"} onBack={onBack} />

      <SectionCard title="Name & color">
        <label class="field">
          <span>Name</span>
          <input type="text" value={d.name} placeholder="e.g. Bedtime, Work focus" onInput={(e) => update({ name: e.currentTarget.value })} />
        </label>
        <div class="colors" role="radiogroup" aria-label="Color">
          {SET_COLORS.map((c) => (
            <button type="button" role="radio" aria-checked={c === d.color} aria-label={c} class={`swatch ${c === d.color ? "selected" : ""}`}
              style={{ background: c }} onClick={() => update({ color: c })} />
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="How strict?"
        info={"Hard block: during the schedule, the sites can't be opened at all. The block page only lets you leave.\n\n" +
          "Soft block: you can still get in by pressing Continue on the block page, but with the limits you choose below " +
          "(a wait before Continue unlocks, a number of opens, and time limits).\n\n" +
          "Reminder: never blocks. A small banner tells you how long you've been on a site every so often, " +
          "e.g. \"reddit.com · 30 minutes so far\".\n\nNeed different rules for different sites? Make more block sets."}
      >
        <div class="stack">
          {([
            ["hard", "Hard block", "No way in during the schedule."],
            ["soft", "Soft block", "Let me in, with a wait and limits."],
            ["reminder", "Reminder", "Never blocks — just tells me how long I've been on."],
          ] as [BlockMode, string, string][]).map(([mode, title, desc]) => (
            <ChoiceCard title={title} description={desc} selected={d.mode === mode} onSelect={() => update({ mode })} />
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Websites"
        subtitle={`${d.targets.length} selected`}
        info={"Websites include all their subdomains (reddit.com also covers old.reddit.com). " +
          "When a site is blocked, leaving opens a new tab page in that tab, and your other tabs stay put."}
      >
        {d.targets.filter((t) => t.kind !== "adult").map((t) => (
          <div class="row">
            <SiteIcon target={t} size={36} />
            <span class="grow">{targetLabel(t)}</span>
            <button type="button" class="text" onClick={() => update({ targets: d.targets.filter((x) => targetKey(x) !== targetKey(t)) })}>Remove</button>
          </div>
        ))}
        <WebsiteAdder onAdd={(t) => {
          if (!d.targets.some((x) => targetKey(x) === targetKey(t))) update({ targets: [...d.targets, t] });
        }} />
        {ADULT_LIST_AVAILABLE && (
          <SwitchSetting
            label="Block adult websites"
            hint="A built-in list of known adult sites"
            checked={d.targets.some((t) => t.kind === "adult")}
            onChange={(on) => update({ targets: on ? [...d.targets, { kind: "adult" }] : d.targets.filter((t) => t.kind !== "adult") })}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Schedule"
        subtitle="When this block set is active"
        info={"The block set only applies during these times. A window that ends earlier than it starts (like 11:30 PM – 8:00 AM) " +
          "runs overnight into the next morning.\n\nTimes follow your computer's clock, so daylight saving never shifts them. " +
          "Soft block limits reset each time a window starts."}
      >
        <ScheduleEditor windows={d.windows} color={d.color} onChange={(windows) => update({ windows })} />
      </SectionCard>

      {overlaps.length > 0 && (
        <section class="card notice">
          <h2>Heads up: overlapping block sets</h2>
          {overlaps.map((w) => <p class="small">• {describeOverlap(w, targetLabel(w.target))}</p>)}
          <p class="small">While they overlap, the strictest one wins.</p>
        </section>
      )}

      {d.mode === "soft" && (
        <SectionCard title="Soft block limits" subtitle="Everything resets when the next window starts.">
          <LimitScopeChooser scope={d.limitScope} onChange={(limitScope) => update({ limitScope })} />
          <NumberSetting
            label="Wait before Continue unlocks" value={d.unlockDelaySec} onInput={(unlockDelaySec) => update({ unlockDelaySec })} unit="sec"
            hint="0 = Continue is available right away"
            info="When you open a blocked site, the Continue button stays locked for this long — a moment to change your mind. If you leave the block page, the wait starts over next time."
          />
          <NumberSetting
            label="Opens allowed" value={d.maxOpens} onInput={(maxOpens) => update({ maxOpens })} unit="opens"
            hint={shared ? "Shared, per window" : "Per site, per window"} blankMeans="Unlimited opens"
            info="How many times you can press Continue for each site during one window. Shown as circles on the block page. Once used up, it's blocked until the window ends."
          />
          <NumberSetting
            label="Time per open" value={d.perOpenMin} onInput={(perOpenMin) => update({ perOpenMin })} unit="min"
            hint="Block page returns after this" blankMeans="No limit per open"
            info="Each open lasts at most this long, then the block page comes back. Leftover time isn't saved — every open starts fresh at this limit."
          />
          <NumberSetting
            label="Total time" value={d.totalMin} onInput={(totalMin) => update({ totalMin })} unit="min"
            hint={shared ? "Shared, per window, across all opens" : "Per site, per window, across all opens"} blankMeans="No total limit"
            info="Combined time across all opens during one window. When it runs out, the current open is cut short and the site stays blocked until the window ends."
          />
          <NumberSetting
            label="Grace period" value={d.graceSec} onInput={(graceSec) => update({ graceSec })} unit="sec"
            hint="Come back within this and it's the same open"
            info="If you switch away from the site briefly and return within this time, it continues the same open instead of using a new one. Time away doesn't count against you."
          />
          <SwitchSetting
            label="Time warnings" checked={d.timeWarnings} onChange={(timeWarnings) => update({ timeWarnings })}
            hint={d.totalMin.trim() === "" ? "Needs a total time limit" : "Banner at 10 min and 1 min of total time left"}
            info="Shows a small banner on the page when 10 minutes and 1 minute of its total time are left in this window, so the block doesn't catch you mid-scroll. It fades after a few seconds. Each warning comes once per window; the 10-minute one is skipped if the total limit is 10 minutes or less."
          />
          <SwitchSetting
            label="Usage reminders" checked={d.softReminders} onChange={(softReminders) => update({ softReminders })}
            hint={'"N minutes so far" banner while you\'re on the site'}
            info="While you're on a site after pressing Continue, shows a small banner every so often with how long you've spent on it this window. Must be shorter than the time per open and the total time."
          />
          {d.softReminders && <ReminderIntervalField value={d.reminderMin} onInput={(reminderMin) => update({ reminderMin })} />}
        </SectionCard>
      )}

      {d.mode === "reminder" && (
        <SectionCard title="Reminders" subtitle="Counts time on the site during the schedule; resets each window.">
          <ReminderIntervalField value={d.reminderMin} onInput={(reminderMin) => update({ reminderMin })} />
          <LimitScopeChooser label="Count time for" scope={d.limitScope} onChange={(limitScope) => update({ limitScope })} />
        </SectionCard>
      )}

      {d.mode !== "reminder" && (
        <SectionCard title="Block page message" info="Shown in big letters every time this block set stops you. Write something that'll actually work on you at 1 AM.">
          <label class="field">
            <span>Message</span>
            <input type="text" value={d.message} placeholder="e.g. Future you will thank you. Go to sleep." onInput={(e) => update({ message: e.currentTarget.value })} />
          </label>
        </SectionCard>
      )}

      <SectionCard title="Safeguards" subtitle="Make it harder to give in on impulse">
        {d.mode !== "reminder" && <>
          <NumberSetting
            label="Emergency pause length" value={d.suspensionMin} onInput={(suspensionMin) => update({ suspensionMin })} unit="min"
            hint="How long an emergency pause lasts"
            info="In a real emergency you can pause the whole block set (with your PIN, if it has one). It turns itself back on after this long. Pausing resets the streak."
          />
          <NumberSetting
            label="Emergency pauses allowed" value={d.maxSuspensions} onInput={(maxSuspensions) => update({ maxSuspensions })} unit="per window"
            hint="Resets when the next window starts" blankMeans="Unlimited pauses"
            info="How many emergency pauses you get during one scheduled window."
          />
          <NumberSetting
            label="Wait between pauses" value={d.cooldownSec} onInput={(cooldownSec) => update({ cooldownSec })} unit="sec"
            hint="After a pause ends"
            info="After an emergency pause ends, you have to wait this long before you can pause again, so pauses can't be chained back-to-back."
          />
        </>}
        <NumberSetting
          label="Cooling-off period" value={d.changeWaitMin} onInput={(changeWaitMin) => update({ changeWaitMin })} unit="min"
          hint="For turning off or weakening this set"
          info="Turning this block set off, or editing it to block less (fewer sites, shorter times, looser limits), only takes effect after this wait — and you can cancel it in the meantime. Changes that block more apply immediately. Lowering this wait also has to wait."
        />
      </SectionCard>

      {original === null ? (
        <SectionCard
          title="PIN"
          subtitle={d.usePin ? "Needed to edit, pause, or turn off this block set" : 'Without a PIN, those just ask "Are you sure?"'}
          info={"A PIN adds a moment of friction before you can weaken a block set. Cooling-off waits apply either way.\n\n" +
            "4–12 digits. There's no recovery — if you forget it, the only way out is removing and reinstalling the extension, " +
            "which deletes all block sets. You choose this when creating the set."}
        >
          <div class="setting">
            <div class="grow setting-label">Protect with a PIN</div>
            <Switch checked={d.usePin} onChange={(usePin) => update({ usePin })} label="Protect with a PIN" />
          </div>
          {d.usePin && <>
            <PinField value={d.pin} onInput={(p) => update({ pin: p })} label="PIN" />
            <PinField value={d.pinConfirm} onInput={(p) => update({ pinConfirm: p })} label="Confirm PIN" />
          </>}
        </SectionCard>
      ) : (
        <Hint>Changes that block less wait {Math.round(original.protection.changeWait / 60000)} min before applying. Changes that block more apply right away.</Hint>
      )}

      {errors.length > 0 && (
        <section class="card errors" role="alert">
          {errors.map((e) => <p>• {e}</p>)}
        </section>
      )}

      <button type="button" class="primary wide" disabled={saving} onClick={() => void save()}>
        {original ? "Save changes" : "Create block set"}
      </button>
    </div>
  );
}

function LimitScopeChooser({ scope, onChange, label = "Limits apply to" }: { scope: LimitScope; onChange: (s: LimitScope) => void; label?: string }) {
  return (
    <div class="stack">
      <div class="setting">
        <div class="grow setting-label">{label}</div>
        <InfoButton
          title={label}
          text={"Each site separately: every site in this set gets its own opens and time — 10 opens means 10 for reddit.com and 10 for youtube.com.\n\n" +
            "All together: one shared pool for the whole set — e.g. 10 opens and 20 minutes across all of them, or one \"30 minutes so far\" " +
            "for all your social sites combined. Switching between sites in the set keeps counting as the same use."}
        />
      </div>
      <div class="two">
        <ChoiceCard title="Each site separately" description="Separate count per site." selected={scope === "eachSite"} onSelect={() => onChange("eachSite")} />
        <ChoiceCard title="All together" description="One shared count for the whole set." selected={scope === "wholeSet"} onSelect={() => onChange("wholeSet")} />
      </div>
    </div>
  );
}

function ReminderIntervalField({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  return (
    <NumberSetting
      label="Remind me every" value={value} onInput={onInput} unit="min" hint="Of time on the site"
      info="Each time you've used a site (or the whole set, if counted together) for another this-many minutes during the window, a banner shows how long you've been on it so far. Default 15 minutes."
    />
  );
}

function WebsiteAdder({ onAdd }: { onAdd: (t: Target) => void }) {
  const [text, setText] = useState("");
  const domain = domainFromUserInput(text);
  const add = (e?: Event) => {
    e?.preventDefault();
    if (!domain) return;
    onAdd(website(domain));
    setText("");
  };
  return (
    <form class="adder" onSubmit={add}>
      <label class="field grow">
        <span>Add a website</span>
        <input type="text" inputMode="url" value={text} placeholder="reddit.com" autoComplete="off" spellcheck={false}
          onInput={(e) => setText(e.currentTarget.value)} />
        <span class="hint">{domain ? `Blocks ${domain} and its subdomains` : "Domain only, no https:// needed"}</span>
      </label>
      <button type="submit" class="tonal" disabled={!domain}>Add</button>
    </form>
  );
}
