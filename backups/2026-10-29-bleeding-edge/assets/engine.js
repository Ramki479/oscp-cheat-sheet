/**
 * Pure helpers: no DOM, no storage, no fetch.
 * Imported by the browser app and by node:test.
 */

export const PINNED_VARIABLES = ["TARGET_IP", "ATTACKER_IP", "DOMAIN"];
export const STATUS_ORDER = ["Syntax Checked", "Lab Tested", "Documented — Untested", "Version-Dependent"];
export const PRIORITY_ORDER = ["Core", "Conditional", "Advanced"];

const TOKEN_RE = /<([A-Z][A-Z0-9_]+)>/g;

/** alias token -> canonical token, e.g. PORT -> TARGET_PORT */
export function buildAliasIndex(variables) {
  const index = {};
  for (const v of variables) {
    for (const a of v.aliases || []) index[a] = v.token;
  }
  return index;
}

/**
 * Replace <TOKEN> placeholders with current values.
 * - Exact token match only (<TARGET> never touches <TARGET_IP>).
 * - Falls back to an alias's canonical value (SHARE -> SHARE_NAME).
 * - Missing values are preserved literally and reported.
 */
export function applyVariables(text, values, aliasIndex = {}) {
  const missing = new Set();
  const out = String(text ?? "").replace(TOKEN_RE, (whole, token) => {
    const direct = values[token];
    if (direct !== undefined && direct !== null && String(direct).length > 0) return String(direct);
    const canonical = aliasIndex[token];
    const aliased = canonical ? values[canonical] : undefined;
    if (aliased !== undefined && aliased !== null && String(aliased).length > 0) return String(aliased);
    missing.add(token);
    return whole;
  });
  return { text: out, missing: [...missing] };
}

/** Text used by the search box for a step. */
export function stepHaystack(step, pageTitle = "") {
  const fields = step.fields || {};
  return [
    pageTitle,
    step.title,
    step.n,
    step.priority,
    step.status,
    step.runOn,
    ...(step.commands || []).map(c => c.code),
    fields.lookFor, fields.decision, fields.next, fields.mistake, fields.evidence,
    fields.purpose, fields.prereqs, fields.success, fields.failure,
    step.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

export function matchesQuery(step, query, pageTitle = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = stepHaystack(step, pageTitle);
  return q.split(/\s+/).every(word => hay.includes(word));
}

export function inPriority(step, priority) {
  return !priority || priority === "all" || step.priority === priority;
}

export function inStatus(step, status) {
  return !status || status === "all" || step.status === status;
}

/** Keep only steps matching priority/status/query; non-step blocks pass through. */
export function filterBlocks(blocks, { priority = "all", status = "all", query = "" } = {}, pageTitle = "") {
  return blocks.filter(b => {
    if (b.type !== "step") return true;
    return inPriority(b, priority) && inStatus(b, status) && matchesQuery(b, query, pageTitle);
  });
}

/** Every step in the dataset. */
export function allSteps(pages) {
  return pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.type === "step").map(b => ({ page: p, section: s, step: b }))));
}

/**
 * Steps tagged with a service, grouped by source page.
 * Returns [{ page, groups: [{ section, steps }] }]
 */
export function serviceGroups(pages, serviceId) {
  const out = [];
  for (const page of pages) {
    const groups = [];
    for (const section of page.sections) {
      const steps = section.blocks.filter(b => b.type === "step" && (b.tags || []).includes(serviceId));
      if (steps.length) groups.push({ section, steps });
    }
    if (groups.length) out.push({ page, groups });
  }
  return out;
}

export function serviceCounts(pages) {
  const counts = {};
  for (const page of pages) {
    for (const section of page.sections) {
      for (const b of section.blocks) {
        if (b.type !== "step") continue;
        for (const t of b.tags || []) counts[t] = (counts[t] || 0) + 1;
      }
    }
  }
  return counts;
}

/** Search across all pages, newest match first is not meaningful here: page order is. */
export function searchAll(pages, query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  for (const page of pages) {
    for (const section of page.sections) {
      for (const b of section.blocks) {
        if (b.type === "step" && matchesQuery(b, q, page.title)) {
          hits.push({ page, section, step: b });
        }
      }
    }
  }
  return hits;
}

export function findStep(pages, stepId) {
  for (const page of pages) {
    for (const section of page.sections) {
      for (const b of section.blocks) {
        if (b.type === "step" && b.id === stepId) return { page, section, step: b };
      }
    }
  }
  return null;
}

export function countSteps(pages) {
  return pages.reduce((n, p) => n + (p.stepCount ?? p.sections.flatMap(s => s.blocks.filter(b => b.type === "step")).length), 0);
}

export function countCommands(pages) {
  return pages.reduce((n, p) => n + (p.commandCount ?? p.sections.flatMap(s => s.blocks.filter(b => b.type === "step")).reduce((m, s) => m + s.commands.length, 0)), 0);
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Guard for user-added variable names. */
export function isValidToken(token) {
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(String(token || ""));
}

export function formatStatus(status) {
  return STATUS_ORDER.includes(status) ? status : "Documented — Untested";
}
