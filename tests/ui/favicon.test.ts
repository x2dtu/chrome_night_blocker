import { describe, expect, it } from "vitest";
import { cacheUrl, directUrl, makeFaviconResolver } from "../../src/ui/favicon";

const GLOBE = new Uint8Array([1, 2, 3]);
const REDDIT = new Uint8Array([9, 9]);

describe("favicon resolver", () => {
  const fetches: string[] = [];
  const fake = async (url: string) => {
    fetches.push(url);
    if (url.includes("reddit")) return REDDIT;
    if (url.includes("broken")) return null;
    return GLOBE; // the browser's generic icon for anything it doesn't know
  };

  it("uses the browser's cache when it has the icon", async () => {
    const resolve = makeFaviconResolver(fake, true);
    expect(await resolve("https://www.reddit.com/r/all", 32)).toBe(cacheUrl("https://www.reddit.com/r/all", 32));
  });

  it("falls back to the site's own favicon.ico when the cache only has the generic icon", async () => {
    const resolve = makeFaviconResolver(fake, true);
    expect(await resolve("https://example.com/page?x=1", 32)).toBe("https://example.com/favicon.ico");
    expect(await resolve("https://broken.example/", 32)).toBe("https://broken.example/favicon.ico");
  });

  it("caches results, and the generic icon once per size", async () => {
    fetches.length = 0;
    const resolve = makeFaviconResolver(fake, true);
    await resolve("https://a.com/", 32);
    await resolve("https://a.com/", 32);
    await resolve("https://b.com/", 32);
    expect(fetches.filter((u) => u.includes("no-such-site"))).toHaveLength(1);
    expect(fetches.filter((u) => u.includes("a.com"))).toHaveLength(1);
  });

  it("browsers without a cache endpoint go straight to the site", async () => {
    fetches.length = 0;
    const resolve = makeFaviconResolver(fake, false);
    expect(await resolve("https://example.com/", 32)).toBe("https://example.com/favicon.ico");
    expect(fetches).toEqual([]);
    expect(directUrl("chrome://extensions")).toBeNull();
  });
});
