import { MINUTES_PER_DAY, dayWindow } from "../../src/core/schedule";
import { ALL_DAYS } from "../../src/core/time";

export const allWeek = ALL_DAYS.map((d) => dayWindow(d, 0, MINUTES_PER_DAY));
export const at = (iso: string) => Date.parse(iso);
