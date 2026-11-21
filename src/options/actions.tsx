import { useState } from "preact/hooks";
import type { ChangeOutcome } from "../core/changeReview";
import { type Zone } from "../core/time";
import type { ActionRequest } from "../shared/messages";
import { ConfirmDialog, PinDialog } from "../ui/components";
import { formatTime } from "../ui/format";
import { act } from "../ui/hooks";
import { useNotify } from "./app";

export interface Protected {
  /** "Enter PIN to pause" */
  readonly pinTitle: string;
  /** Used when the set has no PIN: "Pause Bedtime?" */
  readonly confirmTitle: string;
  readonly confirmText: string;
  /** Builds the request with the entered PIN (undefined when the set has none). */
  readonly request: (pin: string | undefined) => ActionRequest;
  /** Called with the result after it succeeded. */
  readonly onDone?: (outcome?: ChangeOutcome) => void;
}

/**
 * Runs PIN-protected actions: a PIN prompt if the set has a PIN, otherwise "Are you sure?".
 * The worker checks the PIN again. Returns [start(action), dialog element].
 */
export function useProtectedAction(hasPin: boolean) {
  const notify = useNotify();
  const [pending, setPending] = useState<Protected | null>(null);

  const run = async (p: Protected, pin: string | undefined): Promise<string | null> => {
    const result = await act(p.request(pin));
    if (!result.ok) {
      if (result.error === "Wrong PIN") return "Wrong PIN";
      notify(result.error);
      setPending(null);
      return null;
    }
    setPending(null);
    p.onDone?.(result.outcome);
    return null;
  };

  const dialog = pending && (hasPin
    ? <PinDialog title={pending.pinTitle} onSubmit={(pin) => run(pending, pin)} onClose={() => setPending(null)} />
    : <ConfirmDialog title={pending.confirmTitle} text={pending.confirmText} confirm="Yes" onConfirm={() => void run(pending, undefined)} onClose={() => setPending(null)} />);

  return [setPending, dialog] as const;
}

export function outcomeText(outcome: ChangeOutcome | undefined, zone: Zone): string {
  if (!outcome || outcome.type === "applyNow") return "Saved — in effect now";
  const what = outcome.change.proposed.enabled ? "This blocks less, so it takes effect" : "It turns off";
  return `${what} at ${formatTime(outcome.change.appliesAt, zone)}. You can cancel it until then.`;
}
