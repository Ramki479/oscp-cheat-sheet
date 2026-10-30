#!/usr/bin/env node
/**
 * Fail when a precached file changed but the service worker cache name did not.
 *
 * sw.js is cache-first for the shell and stale-while-revalidate for data/*.json, so a
 * visitor whose cache name is unchanged keeps serving the previous dataset on their
 * first load — and indefinitely if they never come back online. The README asks for a
 * VERSION bump on every change to those files; this checks it instead of trusting memory.
 *
 * Usage:
 *   node tools/check-cache-version.mjs           compare the worktree against HEAD (pre-commit)
 *   node tools/check-cache-version.mjs HEAD^     compare HEAD against its parent (in CI)
 *
 * `generatedAt` is a build timestamp, so it is stripped before hashing: two builds from
 * the same sources must compare equal. Exits 0 with a skip when the base revision is not
 * available — a shallow clone at depth 1 has no parent to compare against.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

// Everything precached by sw.js: the dataset plus the shell the browser keeps offline.
const TRACKED = [
  "data/commands.json",
  "data/variables.json",
  "data/tools.json",
  "data/meta.json",
  "index.html",
  "assets/app.css",
  "assets/app.js",
  "assets/engine.js",
  "manifest.webmanifest",
  "icons/icon.svg"
];

const WORKTREE = "<worktree>";
const base = process.argv[2] || "HEAD";
const target = process.argv[2] ? "HEAD" : WORKTREE;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function readRev(rev, rel) {
  try {
    return git("show", `${rev}:${rel}`);
  } catch {
    return null;
  }
}

function read(rev, rel) {
  if (rev === WORKTREE) {
    const full = path.join(ROOT, rel);
    return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  }
  return readRev(rev, rel);
}

function digest(text) {
  if (text === null) return null;
  let payload = text;
  if (text.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      delete parsed.generatedAt; // build timestamp, not content
      payload = JSON.stringify(parsed);
    } catch {
      return null;
    }
  }
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function cacheVersion(text) {
  return /const VERSION = "([^"]+)"/.exec(text || "")?.[1] ?? null;
}

try {
  git("rev-parse", "--verify", base);
} catch {
  console.log(`check:cache — ${base} not available (shallow clone?), skipping`);
  process.exit(0);
}

const changed = TRACKED.filter((rel) => {
  const before = digest(read(base, rel));
  const after = digest(read(target, rel));
  return before !== null && after !== null && before !== after;
});

const label = target === WORKTREE ? "worktree" : target;
const before = cacheVersion(read(base, "sw.js"));
const after = cacheVersion(read(target, "sw.js"));

if (!after) {
  console.error(`check:cache — could not read VERSION from sw.js at ${label}`);
  process.exit(1);
}

if (changed.length === 0) {
  console.log(`check:cache — precached files unchanged (${base} → ${label}), no cache bump needed`);
  process.exit(0);
}

if (before === after) {
  console.error(`check:cache — changed: ${changed.join(", ")}`);
  console.error(`check:cache — but sw.js still says VERSION = "${after}" at ${label}.`);
  console.error("check:cache — bump VERSION in sw.js so returning visitors receive the new data.");
  process.exit(1);
}

console.log(`check:cache — changed: ${changed.join(", ")}; VERSION ${before} → ${after}`);
