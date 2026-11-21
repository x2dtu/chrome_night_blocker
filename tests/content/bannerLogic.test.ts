import { describe, expect, it } from "vitest";
import { badgeLetter, dragEnd } from "../../src/content/bannerLogic";

describe("banner", () => {
  it("badge letter skips www and punctuation", () => {
    expect(badgeLetter("www.youtube.com")).toBe("Y");
    expect(badgeLetter("reddit.com")).toBe("R");
    expect(badgeLetter("9gag.com")).toBe("9");
    expect(badgeLetter("")).toBe("•");
  });

  it("drag: far sideways or up dismisses, a tap fades, a short drag snaps back", () => {
    expect(dragEnd(200, 0, 400, false)).toBe("dismiss");
    expect(dragEnd(-200, 0, 400, false)).toBe("dismiss");
    expect(dragEnd(0, -60, 400, false)).toBe("dismiss");
    expect(dragEnd(2, 1, 400, false)).toBe("fadeOut");
    expect(dragEnd(60, 0, 400, false)).toBe("snapBack");
    expect(dragEnd(60, 0, 400, true)).toBe("fadeOut"); // its time ran out mid-drag
    expect(dragEnd(0, 60, 400, false)).toBe("snapBack"); // down doesn't dismiss
  });
});
