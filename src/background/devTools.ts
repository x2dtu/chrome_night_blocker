// Developer helpers for the service worker console (Inspect views: service worker), until the
// settings UI exists. Only in dev builds (`npm run build`), not in `npm run build:release`.
//
//   nb.state()                              everything stored
//   nb.hardSoon("example.com", 1, 10)       hard block starting in 1 min, for 10 min
//   nb.softNow("example.org", 2, 1)         soft block now for 2 h: 2 opens × 1 min
//   nb.reminderNow("wikipedia.org", 1)      reminder every 1 min, now for 2 h
//   nb.add({ ...block set fields })         any set (see src/core/model.ts)
//   nb.remove(id)                           delete a set right away (skips the rules)
//   nb.reset()                              delete everything

import { EMPTY_STATE } from "../core/appState";
import { type BlockSet, blockSet, protectionSettings, softLimits, website } from "../core/model";
import { type DayWindow, MINUTES_PER_DAY, dayWindow } from "../core/schedule";
import { type DayOfWeek, MINUTE, dayOfWeek, minutes, startOfDay, systemZone, toLocal } from "../core/time";
import type { Controller } from "./controller";

let counter = 0;

export function installDevTools(controller: Controller): void {
  const add = async (fields: Partial<BlockSet> & Pick<BlockSet, "name" | "mode" | "targets" | "windows">) => {
    const set = blockSet({ id: `dev-${Date.now()}-${counter++}`, ...fields });
    await controller.addSet(set);
    console.log(`Added "${set.name}" (${set.id})`);
    return set.id;
  };
  const fromNow = (startInMin: number, lengthMin: number) => windowsBetween(startInMin, startInMin + lengthMin);

  const nb = {
    state: () => controller.getState(),
    add,
    hardSoon: (domain = "example.com", startInMin = 1, lengthMin = 10) =>
      add({ name: `Hard ${domain}`, mode: "hard", targets: [website(domain)], windows: fromNow(startInMin, lengthMin), message: "Go to sleep!" }),
    softNow: (domain = "example.org", maxOpens = 2, perOpenMin = 1, unlockDelaySec = 5) =>
      add({
        name: `Soft ${domain}`, mode: "soft", targets: [website(domain)], windows: fromNow(0, 120), color: "#26a69a",
        softLimits: softLimits({ maxOpens, perOpenLimit: minutes(perOpenMin), totalLimit: minutes(maxOpens * perOpenMin), unlockDelay: unlockDelaySec * 1000 }),
        protection: protectionSettings({ changeWait: 0 }),
      }),
    reminderNow: (domain = "wikipedia.org", everyMin = 1) =>
      add({ name: `Reminder ${domain}`, mode: "reminder", targets: [website(domain)], windows: fromNow(0, 120), color: "#ffa726",
        softLimits: softLimits({ reminderInterval: minutes(everyMin) }) }),
    remove: (id: string) => controller.mutate((s) => ({ ...s, sets: s.sets.filter((x) => x.id !== id) })).then(() => undefined),
    reset: () => controller.mutate(() => EMPTY_STATE).then(() => undefined),
  };
  (globalThis as unknown as { nb: typeof nb }).nb = nb;
  console.log("[Night Blocker] Dev helpers ready: nb.state(), nb.hardSoon(), nb.softNow(), nb.reminderNow(), nb.reset()");
}

/** Day windows covering [startInMin, endInMin) minutes from now, split at midnight. */
function windowsBetween(startInMin: number, endInMin: number): DayWindow[] {
  const nowLocal = toLocal(Date.now(), systemZone());
  const minuteNow = Math.floor((nowLocal - startOfDay(nowLocal)) / MINUTE);
  let start = minuteNow + startInMin; // minutes since today's midnight
  const end = minuteNow + endInMin;
  const windows: DayWindow[] = [];
  for (let d = 0; start < end; d++) {
    const dayEnd = (d + 1) * MINUTES_PER_DAY;
    if (start < dayEnd) {
      const day = ((dayOfWeek(nowLocal) + d) % 7) as DayOfWeek;
      windows.push(dayWindow(day, start - d * MINUTES_PER_DAY, Math.min(end, dayEnd) - d * MINUTES_PER_DAY));
      start = Math.min(end, dayEnd);
    }
  }
  return windows;
}
