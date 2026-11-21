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
npm run build:release  # same as build, without the developer helpers
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

Incognito: the extension doesn't see Incognito windows unless you turn on **Details → Allow in
Incognito**. (Phase 7 turns Incognito off by policy instead.)

Debugging: on the Night Blocker card, **Inspect views: service worker** opens DevTools for the
background worker; errors also show up under the card's **Errors** button.

## Trying it out before the settings page exists

Development builds (`npm run build` / `watch`) add helpers to the background worker's console.
On the extension card click **Inspect views: service worker**, open the **Console**, and type:

```js
nb.hardSoon("example.com", 0, 10)   // hard block on example.com, starting now, for 10 min
nb.softNow("example.org", 2, 1, 5)  // soft block: 2 opens × 1 min, 5 s unlock delay, for 2 h
nb.reminderNow("wikipedia.org", 1)  // "N minutes so far" every minute, for 2 h
nb.banner()                         // a sample banner on the active tab, right now
nb.state()                          // everything stored
nb.remove("<set id>")               // delete one set right away
nb.reset()                          // delete everything
```

Things to check:
1. **Hard block:** with `hardSoon("example.com", 0, 10)`, opening https://example.com/anything shows
   the block page; already-open example.com tabs switch to it too. `hardSoon("example.com", 1, 2)`
   — the tab switches by itself a minute later, and goes back to the page when the window ends.
2. **Soft block:** with `softNow()`, example.org shows the block page with "2/2 opens left" and a
   countdown; Continue goes back to the page. After 1 minute on the page it's blocked again;
   after both opens, "all 2 opens used".
3. **Not counting:** during an open, switch to another app or tab for over 15 s — coming back
   needs a new open. Time on the block page and while the laptop sleeps doesn't count
   (`nb.state()` → `usage` → `timeUsed`, in ms).
4. **Idle** (3 min without input, or screen locked; a tab playing audio is never idle): an open
   with a time limit keeps counting and can run out while you're away; an open without one
   ends after the grace period.
5. **Banner:** with `reminderNow()`, after a minute on wikipedia.org a banner "www.wikipedia.org ·
   1 minute so far" slides in at the top and fades after ~4.5 s; click it or drag it sideways/up
   to dismiss. `nb.banner()` shows a sample on the active tab right away (reload tabs opened
   before the extension was reloaded first).
6. **Restarts:** quit and reopen the browser, or click the card's reload ↻ — sets and usage stay.

Release builds (`npm run build:release`) leave the helpers out.

## Layout

```
static/      manifest.json, HTML and CSS — copied to dist/ as-is
src/
  background/  service worker: controller.ts (tabs, timing, saving — unit-tested with a fake
               browser), chromeApi.ts (the real chrome.* calls), index.ts (event wiring)
  options/     settings page
  block/       block page shown instead of a blocked site
  content/     content script (on-page warning banner)
  core/        pure logic with unit tests — no chrome.* APIs
  shared/      message types and block page URLs shared by the worker and pages
tests/       Vitest tests
build.mjs    esbuild bundling + static copy
```
