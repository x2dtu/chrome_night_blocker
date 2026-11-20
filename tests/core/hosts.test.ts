import { afterEach, describe, expect, it } from "vitest";
import { setAdultSiteMatcher } from "../../src/core/adultSites";
import { domainFromUserInput, hostFromUrl, hostFromUserInput } from "../../src/core/hosts";
import { ADULT_SITES, targetFromKey, targetKey, targetMatches, website } from "../../src/core/model";

describe("hosts", () => {
  it("extracts host from user input", () => {
    expect(hostFromUserInput("reddit.com")).toBe("reddit.com");
    expect(hostFromUserInput("https://www.Reddit.com/r/all?x=1#top")).toBe("www.reddit.com");
    expect(hostFromUserInput("old.reddit.com/r/android")).toBe("old.reddit.com");
    expect(hostFromUserInput("http://user@localhost.test:8080/x")).toBe("localhost.test");
    expect(hostFromUserInput("  example.com.  ")).toBe("example.com");
    expect(hostFromUserInput("münchen.de")).toBe("xn--mnchen-3ya.de");
  });

  it("rejects non-sites", () => {
    expect(hostFromUserInput("how to sleep better")).toBeNull();
    expect(hostFromUserInput("reddit")).toBeNull();
    expect(hostFromUserInput("")).toBeNull();
    expect(hostFromUserInput("chrome://newtab")).toBeNull();
    expect(hostFromUserInput("ftp://example.com")).toBeNull();
  });

  it("user input drops www", () => {
    expect(domainFromUserInput("https://www.reddit.com/")).toBe("reddit.com");
    expect(domainFromUserInput("m.youtube.com")).toBe("m.youtube.com");
  });

  it("host from page URLs", () => {
    expect(hostFromUrl("https://old.reddit.com/r/all")).toBe("old.reddit.com");
    expect(hostFromUrl("http://localhost:3000/")).toBe("localhost");
    expect(hostFromUrl("chrome://extensions")).toBeNull();
    expect(hostFromUrl("chrome-extension://abc/block/block.html")).toBeNull();
    expect(hostFromUrl("about:blank")).toBeNull();
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

describe("targets", () => {
  afterEach(() => setAdultSiteMatcher(null));

  it("website target matches domain and subdomains only", () => {
    const t = website("reddit.com");
    expect(targetMatches(t, "reddit.com")).toBe(true);
    expect(targetMatches(t, "old.reddit.com")).toBe(true);
    expect(targetMatches(t, "notreddit.com")).toBe(false);
    expect(targetMatches(t, "reddit.com.evil.net")).toBe(false);
  });

  it("adult target uses the installed list", () => {
    expect(targetMatches(ADULT_SITES, "adult.example")).toBe(false);
    setAdultSiteMatcher((h) => h.endsWith("adult.example"));
    expect(targetMatches(ADULT_SITES, "www.adult.example")).toBe(true);
  });

  it("keys round-trip and websites must be lowercase", () => {
    for (const t of [website("reddit.com"), ADULT_SITES]) expect(targetFromKey(targetKey(t))).toEqual(t);
    expect(() => website("Reddit.com")).toThrow();
    expect(() => website(" ")).toThrow();
  });
});
