// Bundles the extension into a single dist/ folder that can be loaded with "Load unpacked".
//   node build.mjs          one-off build
//   node build.mjs --watch  rebuild on every change
import * as esbuild from "esbuild";
import { cpSync, rmSync, watch } from "node:fs";

const isWatch = process.argv.includes("--watch");
const outdir = "dist";

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: {
    background: "src/background/index.ts",
    "options/options": "src/options/options.ts",
    "block/block": "src/block/block.ts",
    content: "src/content/banner.ts",
  },
  outdir,
  bundle: true,
  // Content scripts can't be ES modules; IIFE everywhere keeps it uniform.
  format: "iife",
  target: "chrome116",
  sourcemap: true,
  logLevel: "info",
};

function copyStatic() {
  cpSync("static", outdir, { recursive: true });
}

rmSync(outdir, { recursive: true, force: true });

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  watch("static", { recursive: true }, () => {
    copyStatic();
    console.log("[static] copied");
  });
  console.log("Watching… (reload the extension in the browser after changes)");
} else {
  await esbuild.build(options);
  copyStatic();
}
