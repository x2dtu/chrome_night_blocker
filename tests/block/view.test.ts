import { describe, expect, it } from "vitest";
import { chipText, continueLabel, openDots, resetKey, softStats, streakText, timeLeftText } from "../../src/block/view";
import { minutes as min, seconds as sec } from "../../src/core/time";
import type { BlockPageModel, SoftGateInfo } from "../../src/shared/messages";

const soft: SoftGateInfo = { unlockDelay: sec(10), opensUsed: 2, maxOpens: 4, timeLeft: min(8) + sec(30), totalLimit: min(20), limitsSummary: "3 min per open" };
const model = (fields: Partial<BlockPageModel> = {}): BlockPageModel => ({
  status: "softGate", host: "www.reddit.com", setName: "Night Socials", color: "#5c6bc0",
  message: "", streakDays: 0, reasons: [], soft, ...fields,
});

describe("block page view", () => {
  it("opens and time left", () => {
    expect(softStats(soft)).toBe("2/4 opens left · 8 of 20 min left");
    expect(softStats({ ...soft, timeLeft: sec(40) })).toBe("2/4 opens left · <1 min of 20 min left");
    expect(softStats({ ...soft, maxOpens: null })).toBe("8 of 20 min left");
    expect(softStats({ ...soft, totalLimit: null, timeLeft: null })).toBe("2/4 opens left");
    expect(timeLeftText(min(45), min(90))).toBe("45 of 90 min left");
  });

  it("open circles: used, the one Continue uses, the rest", () => {
    expect(openDots(2, 4)).toEqual(["used", "used", "next", "left"]);
    expect(openDots(0, 1)).toEqual(["next"]);
  });

  it("labels", () => {
    expect(chipText(model())).toBe("Night Socials · limited");
    expect(chipText(model({ status: "blocked", setName: "Bedtime" }))).toBe("Bedtime · blocked");
    expect(streakText(0)).toBe("");
    expect(streakText(5)).toBe("🔥 5-day streak — don't break it");
    expect(continueLabel(7)).toBe("Continue in 7s");
    expect(continueLabel(0)).toBe("Continue to site");
  });

  it("countdown restarts when an open was used", () => {
    expect(resetKey(model())).toBe(resetKey(model({ message: "changed" })));
    expect(resetKey(model())).not.toBe(resetKey(model({ soft: { ...soft, opensUsed: 3 } })));
  });
});
