# Night Blocker (browser extension)

Manifest V3 extension for Chrome, Brave and Edge that blocks distracting sites on a schedule —
hard, soft and reminder modes, emergency pause, cooling-off for loosening edits, on-page
warnings and an optional adult-site filter. Browser port of the Android Night Blocker app.

## Build

Needs Node 20+.

```sh
npm install
npm run build      # bundles everything into dist/
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript, no output
npm run check      # all three
npm run watch      # rebuild dist/ on every change
```

`dist/` is the folder you load into the browser. It's self-contained, so you can copy it to
another computer (e.g. zip it, move it to the Windows laptop, unzip).

## Load it into the browser ("Load unpacked")

| Browser | Extensions page | Developer mode switch |
|---|---|---|
| Chrome | `chrome://extensions` | top right |
| Brave  | `brave://extensions`  | top right |
| Edge   | `edge://extensions`   | left sidebar |

1. Open the extensions page for your browser (paste the address into the address bar).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dist` folder.
4. Optional: click the puzzle-piece icon in the toolbar and pin **Night Blocker**.

Settings: on the extensions page click **Details → Extension options**.

## After changing the code

1. `npm run build` (or keep `npm run watch` running).
2. On the extensions page, click the **reload** ↻ icon on the Night Blocker card.
3. Reload any open tabs that should get the new content script (pages opened before the
   reload keep the old one).

If you copied `dist/` to another machine, copy it again to the **same folder** and press
reload — loading from a new folder creates a separate extension with its own settings.

Debugging: on the Night Blocker card, **Inspect views: service worker** opens DevTools for the
background worker; errors also show up under the card's **Errors** button.

## Layout

```
static/      manifest.json, HTML and CSS — copied to dist/ as-is
src/
  background/  service worker (navigation interception, timing, alarms)
  options/     settings page
  block/       block page shown instead of a blocked site
  content/     content script (on-page warning banner)
  core/        pure logic with unit tests — no chrome.* APIs
tests/       Vitest tests
build.mjs    esbuild bundling + static copy
```
