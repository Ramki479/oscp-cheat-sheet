#!/usr/bin/env node
/**
 * Assemble the deployable site into build/.
 *
 * tools/parse.mjs writes the generated dataset into data/ in place, next to the
 * sources. Hosts that want a dedicated publish directory (Render, Netlify, any
 * "output directory" setting) need the shell and the dataset collected in one
 * place, and they must not serve content/, tools/, tests/, audit/ or backups/.
 *
 * Only files the browser actually requests are copied.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "build");

const FILES = ["index.html", "manifest.webmanifest", "sw.js"];
const DIRS = ["assets", "icons", "data"];

const REQUIRED = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "assets/app.css",
  "assets/app.js",
  "assets/engine.js",
  "icons/icon.svg",
  "data/commands.json",
  "data/variables.json",
  "data/meta.json",
  "data/tools.json"
];

// Start clean so a file deleted from the source cannot linger in build/.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(OUT, file));
}

for (const dir of DIRS) {
  const src = path.join(ROOT, dir);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(OUT, dir), { recursive: true });
}

const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(OUT, rel)));
if (missing.length) {
  console.error(`bundle: build/ is incomplete, missing:\n  ${missing.join("\n  ")}`);
  console.error("bundle: run `node tools/parse.mjs` first (npm run build does both).");
  process.exit(1);
}

function walk(dir, base = dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full));
  }
  return acc;
}

const files = walk(OUT).sort();
const bytes = files.reduce((sum, rel) => sum + fs.statSync(path.join(OUT, rel)).size, 0);

console.log(`bundle: build/ ready — ${files.length} files, ${(bytes / 1024).toFixed(1)} KiB`);
