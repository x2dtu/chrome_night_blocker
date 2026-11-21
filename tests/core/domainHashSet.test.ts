import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { isAdultSite } from "../../src/core/adultSites";
import { DomainHashSet, encodeDomainList, fnv1a64 } from "../../src/core/domainHashSet";
import { ADULT_SITES, targetMatches } from "../../src/core/model";
import { adultListSizeLabel, ensureAdultList, resetAdultList } from "../../src/shared/adultList";

describe("domain hash set", () => {
  afterEach(resetAdultList);

  it("hash matches the python generator", () => {
    // Values printed by tools/build_domain_list.py's fnv1a64 (same as the Android tests).
    expect(fnv1a64("")).toBe(-3750763034362895579n);
    expect(fnv1a64("a")).toBe(-5808556873153909620n);
    expect(fnv1a64("example.com")).toBe(6298361471204529350n);
    expect(fnv1a64("old.reddit.com")).toBe(-1262417720040770913n);
  });

  it("matches listed domains and their subdomains only", () => {
    const set = DomainHashSet.parse(encodeDomainList(["badsite.com", "naughty.co.uk"]));
    expect(set.size).toBe(2);
    expect(set.containsHostOrParent("badsite.com")).toBe(true);
    expect(set.containsHostOrParent("www.BadSite.com.")).toBe(true);
    expect(set.containsHostOrParent("a.b.naughty.co.uk")).toBe(true);
    expect(set.containsHostOrParent("notbadsite.com")).toBe(false);
    expect(set.containsHostOrParent("co.uk")).toBe(false);
    expect(set.containsHostOrParent("com")).toBe(false);
    expect(set.containsHostOrParent("")).toBe(false);
  });

  it("rejects other files", () => {
    expect(() => DomainHashSet.parse(new ArrayBuffer(4))).toThrow();
    expect(() => DomainHashSet.parse(new TextEncoder().encode("hello world!!").buffer)).toThrow();
  });

  it("adult target uses the loaded list", async () => {
    expect(targetMatches(ADULT_SITES, "badsite.com")).toBe(false); // not loaded yet
    await ensureAdultList(async () => encodeDomainList(["badsite.com"]));
    expect(targetMatches(ADULT_SITES, "m.badsite.com")).toBe(true);
    expect(targetMatches(ADULT_SITES, "google.com")).toBe(false);
  });

  it("bundled list loads and matches known sites", async () => {
    const file = readFileSync(new URL("../../static/data/adult_domains.bin", import.meta.url));
    const started = performance.now();
    const list = await ensureAdultList(async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    const ms = performance.now() - started;
    expect(list.size).toBeGreaterThan(100_000);
    expect(isAdultSite("www.pornhub.com")).toBe(true);
    for (const ok of ["google.com", "reddit.com", "old.reddit.com", "tumblr.com", "x.com", "wikipedia.org", "youtube.com"]) {
      expect(isAdultSite(ok), ok).toBe(false);
    }
    expect(adultListSizeLabel()).toBe("about 937,000");
    console.log(`parsed ${list.size} hashes in ${ms.toFixed(0)} ms`);
  });
});
