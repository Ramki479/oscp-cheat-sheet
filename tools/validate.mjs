#!/usr/bin/env node
/** Data contract checks. Run after `npm run build`. */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8"));
const { pages, services } = read("commands.json");
const { variables } = read("variables.json");
const meta = read("meta.json");

const STATUSES = new Set(["Lab Tested", "Simulated", "Syntax Checked", "Environment Dependent", "Documented"]);
const PRIORITIES = new Set(["Core", "Conditional", "Advanced"]);
const errors = [];
const notes = [];

const fail = (m) => errors.push(m);

// 24 parsed source pages plus the generated tool reference.
if (pages.length !== 25) fail(`expected 24 source pages + 1 generated tool reference, got ${pages.length}`);
if (meta.pageCount !== pages.length) fail("meta.pageCount does not match the page list");
const steps = pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.type === "step")));
if (steps.length < 280) fail(`suspiciously few steps: ${steps.length}`);

const ids = new Set();
for (const p of pages) {
  if (!p.title || !p.slug || !p.group) fail(`page missing title/slug/group: ${p.slug}`);
  if (!p.sections.length) fail(`page has no sections: ${p.slug}`);
  for (const s of p.sections) {
    if (!s.title) fail(`section without title in ${p.slug}`);
    if (!s.blocks.length) notes.push(`empty section: ${p.slug} / ${s.title}`);
    for (const b of s.blocks) {
      if (b.type !== "step") continue;
      if (ids.has(b.id)) fail(`duplicate step id: ${b.id}`);
      ids.add(b.id);
      if (!b.title) fail(`step without title: ${b.id}`);
      if (!STATUSES.has(b.status)) fail(`bad status "${b.status}" in ${b.id}`);
      if (!PRIORITIES.has(b.priority)) fail(`bad priority "${b.priority}" in ${b.id}`);
      if (!Array.isArray(b.tags) || !b.tags.length) fail(`step without tags: ${b.id}`);
      for (const c of b.commands) {
        if (!c.code.trim()) fail(`empty command: ${b.id}`);
      }
    }
  }
}

const commandTokens = new Set();
for (const s of steps) for (const c of s.commands) {
  for (const m of c.code.matchAll(/<([A-Z][A-Z0-9_]+)>/g)) commandTokens.add(m[1]);
}
const known = new Set(variables.map(v => v.token));
for (const v of variables) for (const a of v.aliases || []) known.add(a);
for (const t of commandTokens) {
  if (!known.has(t)) fail(`command token <${t}> has no registry entry`);
}

const serviceIds = new Set(services.map(s => s.id));
for (const s of steps) for (const t of s.tags) {
  if (!serviceIds.has(t)) fail(`step ${s.id} tagged with unknown service "${t}"`);
}

const serialised = JSON.stringify({ pages, services });
if (serialised.includes("app.notion.com")) fail("Notion links are still present in the generated data");
if (serialised.includes("Related pages")) fail("stale \"Related pages\" text is still present");
if (serialised.includes("Quick navigation")) fail("stale \"Quick navigation\" list is still present");
for (const p of pages) {
  if (p.sections.some(s => s.title === "Related pages")) fail(`Related pages section still present: ${p.slug}`);
}

const statusCounts = steps.reduce((a, s) => (a[s.status] = (a[s.status] || 0) + 1, a), {});
for (const s of meta.statuses) {
  if (!STATUSES.has(s)) fail(`meta.statuses contains an unknown status: ${s}`);
}
if (meta.statuses.length !== STATUSES.size) fail("meta.statuses does not list all five verification statuses");
if ((statusCounts["Lab Tested"] || 0) > 0) notes.push("some steps claim Lab Tested — verify this is intentional");

// The tool reference is generated, so check it exists and stays complete.
const toolPage = pages.find(p => p.slug === "tool-reference");
if (!toolPage) {
  fail("generated tool-reference page is missing");
} else {
  const statusSection = toolPage.sections.find(s => s.id === "tool-reference-status");
  const legend = statusSection?.blocks.find(b => b.type === "table");
  if (!statusSection) fail("tool-reference page has no verification-status section");
  else if (!legend || legend.rows.length !== STATUSES.size) fail("verification-status table must have one row per status");
  if (!toolPage.sections.some(s => (s.blocks || []).some(b => b.type === "table" && b.headers?.includes("Run as")))) {
    fail("tool-reference page has no tool tables");
  }
}

const toolsFile = path.join(ROOT, "data", "tools.json");
if (!fs.existsSync(toolsFile)) {
  fail("data/tools.json is missing — run npm run build");
} else {
  const { tools } = JSON.parse(fs.readFileSync(toolsFile, "utf8"));
  if (!Array.isArray(tools) || tools.length < 20) fail(`tool registry looks wrong: ${tools?.length} entries`);
  const required = ["id", "name", "executable", "package", "install", "os", "privileges", "compat", "category"];
  const ids = new Set();
  for (const t of tools) {
    for (const key of required) if (!t[key]) fail(`tool ${t.id || "<unknown>"} is missing ${key}`);
    if (ids.has(t.id)) fail(`duplicate tool id: ${t.id}`);
    ids.add(t.id);
    if (!t.usedBy.length) fail(`tool ${t.id} is registered but no step uses it`);
    for (const pageTitle of t.usedBy) {
      if (!pages.some(p => p.title === pageTitle)) fail(`tool ${t.id} points at unknown page "${pageTitle}"`);
    }
  }
}

console.log(`pages: ${pages.length}`);
console.log(`steps: ${steps.length}`);
console.log(`commands: ${steps.reduce((n, s) => n + s.commands.length, 0)}`);
console.log(`variables: ${variables.length}`);
console.log(`command tokens: ${commandTokens.size}`);
console.log(`statuses: ${JSON.stringify(statusCounts)}`);
console.log(`extraction warnings: ${meta.warnings.length}`);
if (notes.length) console.log(`notes:\n  ${notes.join("\n  ")}`);
if (errors.length) {
  console.error(`FAIL (${errors.length}):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("OK");
