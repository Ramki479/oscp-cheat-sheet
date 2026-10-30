import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUILD = path.join(ROOT, "build");

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

const NOT_SERVED = ["content", "tools", "tests", "audit", "backups", "node_modules"];

test("bundle step produces the publish directory hosts expect", () => {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "bundle.mjs")], { cwd: ROOT, stdio: "pipe" });

  const missing = REQUIRED.filter(rel => !fs.existsSync(path.join(BUILD, rel)));
  assert.deepEqual(missing, [], "build/ must contain every file the browser requests");
});

test("bundle step keeps sources out of the public directory", () => {
  const leaked = NOT_SERVED.filter(dir => fs.existsSync(path.join(BUILD, dir)));
  assert.deepEqual(leaked, [], "build/ must not ship sources, tests or raw content");
});

test("bundled shell points at files the bundle actually contains", () => {
  const sw = fs.readFileSync(path.join(BUILD, "sw.js"), "utf8");
  const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)]
    .map(m => m[1])
    .filter(Boolean);

  assert.ok(shell.length > 0, "sw.js should list a precache shell");
  const missing = shell.filter(rel => !fs.existsSync(path.join(BUILD, rel)));
  assert.deepEqual(missing, [], "every precached path must exist in build/");
});

test("bundled service worker carries the source cache version", () => {
  const version = (file) => /const VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(file), "utf8"))?.[1];

  const source = version(path.join(ROOT, "sw.js"));
  assert.match(source || "", /^oscp-cheat-v\d+$/, "sw.js must pin a cache version");
  assert.equal(version(path.join(BUILD, "sw.js")), source, "build/ must ship the current version");
});
