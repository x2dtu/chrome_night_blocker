import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../static/manifest.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("manifest", () => {
  it("is Manifest V3 with a service worker", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background.js");
  });

  it("requests exactly the planned permissions", () => {
    expect([...manifest.permissions].sort()).toEqual(
      ["alarms", "declarativeNetRequest", "favicon", "idle", "storage", "tabs", "webNavigation"].sort(),
    );
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
  });

  it("keeps its version in step with package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });
});
