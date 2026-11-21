// Pure parts of the on-page banner, unit-tested.

export const SHOW_MS = 4500;
export const FADE_IN_MS = 200;
export const FADE_OUT_MS = 300;
/** Dragged this fraction of its width sideways, or this far up, dismisses it. */
export const DISMISS_FRACTION = 0.35;
export const DISMISS_UP_PX = 40;
/** Movement below this is a tap. */
export const TAP_SLOP_PX = 6;

/** The letter in the badge: "reddit.com" → "R", "www.youtube.com" → "Y". */
export function badgeLetter(host: string): string {
  const name = host.replace(/^www\./, "");
  return (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase();
}

export type DragEnd = "dismiss" | "fadeOut" | "snapBack";

/** What happens when the pointer lifts after moving the banner by (dx, dy). */
export function dragEnd(dx: number, dy: number, width: number, dueWhileDragging: boolean): DragEnd {
  if (Math.abs(dx) > width * DISMISS_FRACTION || dy < -DISMISS_UP_PX) return "dismiss";
  const tapped = Math.abs(dx) <= TAP_SLOP_PX && Math.abs(dy) <= TAP_SLOP_PX;
  return tapped || dueWhileDragging ? "fadeOut" : "snapBack";
}
