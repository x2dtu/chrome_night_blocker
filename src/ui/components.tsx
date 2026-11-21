import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Target } from "../core/model";
import { type DayWindow, MINUTES_PER_DAY } from "../core/schedule";
import { ALL_DAYS, dayName } from "../core/time";
import { type WindowGroup, describeDays, describeTimes } from "../core/windowGroups";
import { faviconUrl } from "./format";

export function ScreenHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <header class="screen-header">
      {onBack && <button type="button" class="text back" onClick={onBack}>← Back</button>}
      <h1>{title}</h1>
      {subtitle && <p class="subtitle">{subtitle}</p>}
    </header>
  );
}

export function SectionCard({ title, subtitle, info, children }: { title: string; subtitle?: string; info?: string; children?: ComponentChildren }) {
  return (
    <section class="card">
      <div class="card-head">
        <div class="grow">
          <h2>{title}</h2>
          {subtitle && <p class="hint">{subtitle}</p>}
        </div>
        {info && <InfoButton title={title} text={info} />}
      </div>
      {children}
    </section>
  );
}

export function InfoButton({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="info" aria-label={`About ${title}`} onClick={() => setOpen(true)}>i</button>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)} actions={<button type="button" class="text" onClick={() => setOpen(false)}>Got it</button>}>
          {text.split("\n\n").map((p) => <p>{p}</p>)}
        </Dialog>
      )}
    </>
  );
}

/** Modal dialog. Escape or the backdrop closes it. */
export function Dialog({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: ComponentChildren; children?: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      class="dialog"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      <div class="dialog-body">
        <h2>{title}</h2>
        {children}
        {actions && <div class="dialog-actions">{actions}</div>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({ title, text, confirm, onConfirm, onClose }: { title: string; text: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={title} onClose={onClose} actions={<>
      <button type="button" class="text" onClick={onClose}>Cancel</button>
      <button type="button" class="text strong" onClick={onConfirm}>{confirm}</button>
    </>}>
      {text && <p>{text}</p>}
    </Dialog>
  );
}

/** Asks for the PIN; [onSubmit] returns an error message (e.g. "Wrong PIN") or null when done. */
export function PinDialog({ title, onSubmit, onClose }: { title: string; onSubmit: (pin: string) => Promise<string | null>; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e?: Event) => {
    e?.preventDefault();
    setBusy(true);
    const err = await onSubmit(pin);
    setBusy(false);
    if (err) {
      setError(err);
      setPin("");
    }
  };
  return (
    <Dialog title={title} onClose={onClose} actions={<>
      <button type="button" class="text" onClick={onClose}>Cancel</button>
      <button type="button" class="text strong" disabled={busy || pin.length === 0} onClick={() => void submit()}>Confirm</button>
    </>}>
      <form onSubmit={(e) => void submit(e)}>
        <PinField value={pin} onInput={setPin} label="PIN" autoFocus />
      </form>
      {error && <p class="error">{error}</p>}
    </Dialog>
  );
}

export function PinField({ value, onInput, label, autoFocus }: { value: string; onInput: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label class="field">
      <span>{label}</span>
      <input
        type="password" inputMode="numeric" autoComplete="off" maxLength={12} autoFocus={autoFocus}
        value={value} onInput={(e) => onInput(e.currentTarget.value.replace(/\D/g, ""))}
      />
    </label>
  );
}

/** Digits only; empty is allowed when [blankMeans] is given (e.g. "No limit"). */
export function NumberSetting(props: {
  label: string; value: string; onInput: (v: string) => void; unit: string; hint?: string; blankMeans?: string; info?: string;
}) {
  const blank = props.value.trim() === "";
  return (
    <div class="setting">
      <div class="grow">
        <div class="setting-label">{props.label}</div>
        <p class="hint">{blank && props.blankMeans ? props.blankMeans : props.hint}</p>
      </div>
      {props.info && <InfoButton title={props.label} text={props.info} />}
      <label class="number">
        <input
          type="text" inputMode="numeric" value={props.value} aria-label={props.label}
          placeholder={props.blankMeans ? "∞" : "0"}
          onInput={(e) => props.onInput(e.currentTarget.value.replace(/\D/g, ""))}
        />
        <span>{props.unit}</span>
      </label>
    </div>
  );
}

export function SwitchSetting({ label, hint, info, checked, onChange }: { label: string; hint?: string; info?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div class="setting">
      <div class="grow">
        <div class="setting-label">{label}</div>
        {hint && <p class="hint">{hint}</p>}
      </div>
      {info && <InfoButton title={label} text={info} />}
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} class={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function ChoiceCard({ title, description, selected, onSelect }: { title: string; description: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" class={`choice ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <span class="choice-title">{title}</span>
      <span class="hint">{description}</span>
    </button>
  );
}

export function Pill({ text, color }: { text: string; color: string }) {
  return <span class="pill" style={{ "--c": color }}>{text}</span>;
}

export function ColorDot({ color, size = 12 }: { color: string; size?: number }) {
  return <span class="color-dot" style={{ background: color, width: `${size}px`, height: `${size}px` }} />;
}

export function Hint({ children }: { children?: ComponentChildren }) {
  return <p class="hint">{children}</p>;
}

export function SiteIcon({ target, size = 32 }: { target: Target; size?: number }) {
  const style = { width: `${size}px`, height: `${size}px` };
  if (target.kind === "website") {
    return <span class="site-icon" style={style}><img src={faviconUrl(target.domain, 32)} alt="" width={size * 0.6} height={size * 0.6} /></span>;
  }
  return <span class="site-icon badge" style={{ ...style, fontSize: `${size * 0.34}px` }}>{target.kind === "adult" ? "18+" : "•"}</span>;
}

/** Seven stacked bars, one per day; blocked times are drawn in [color]. */
export function WeekBars({ windows, color }: { windows: readonly DayWindow[]; color: string }) {
  return (
    <div class="week-bars" style={{ "--c": color }}>
      {ALL_DAYS.map((day) => (
        <div class="week-row">
          <span class="day">{dayName(day)}</span>
          <div class="track">
            {windows.filter((w) => w.day === day).map((w) => (
              <span class="fill" style={{ left: `${(w.startMinute / MINUTES_PER_DAY) * 100}%`, width: `${((w.endMinute - w.startMinute) / MINUTES_PER_DAY) * 100}%` }} />
            ))}
          </div>
        </div>
      ))}
      <div class="week-scale"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
    </div>
  );
}

/** One row per time range ("11:30 PM – 8:00 AM (next day)" / "Sun–Thu"). */
export function WindowGroupRow({ group, color, onEdit, onRemove }: { group: WindowGroup; color: string; onEdit?: () => void; onRemove?: () => void }) {
  const body = (
    <>
      <ColorDot color={color} size={10} />
      <span class="grow">
        <span class="row-title">{describeTimes(group)}</span>
        <span class="hint">{describeDays(group.days)}</span>
      </span>
    </>
  );
  return (
    <div class="window-row">
      {onEdit ? <button type="button" class="window-main" onClick={onEdit}>{body}</button> : <div class="window-main">{body}</div>}
      {onRemove && <button type="button" class="text" onClick={onRemove}>Remove</button>}
    </div>
  );
}

/** Bottom message, e.g. "Saved — in effect now". */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [text]);
  return <div class="toast" role="status" onClick={onDone}>{text}</div>;
}
