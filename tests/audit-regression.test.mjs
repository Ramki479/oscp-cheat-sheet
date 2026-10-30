/**
 * Regression tests for defects confirmed by the 2026-10-29 exam-readiness audit.
 * Each test names the defect it locks down.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8"));
const { pages } = read("commands.json");
const steps = pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.type === "step")));

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&nbsp;/g, " ")
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

const stepById = (id) => {
  for (const p of pages) {
    for (const s of p.sections) {
      for (const b of s.blocks) if (b.type === "step" && b.id === id) return b;
    }
  }
  return null;
};

test("every source code fence survives into the dataset byte-for-byte", () => {
  // Defect: normalise() stripped anything that looked like an HTML tag inside a
  // fence, corrupting `</dev/null`, `<python3>` and `<TARGET_COMPUTER$>`.
  for (const p of pages) {
    if (p.generated) continue; // the tool reference has no source export
    const raw = decodeEntities(fs.readFileSync(path.join(ROOT, "content/raw", `${p.slug}.html`), "utf8"));
    const fences = [];
    for (const m of raw.matchAll(/```[a-zA-Z0-9+#-]*\n([\s\S]*?)```/g)) {
      fences.push(m[1].replace(/\s+$/, ""));
    }
    const blocks = [];
    for (const s of p.sections) {
      for (const b of s.blocks) {
        if (b.type === "step") {
          for (const c of b.commands || []) blocks.push(c.code);
          for (const o of b.outputs || []) blocks.push(o.code);
        } else if (b.type === "code" || b.type === "output") {
          blocks.push(b.code);
        }
      }
    }
    assert.deepEqual(blocks.slice().sort(), fences.slice().sort(), `fence/data mismatch on ${p.slug}`);
  }
});

test("shell redirections and angle-bracket placeholders are preserved verbatim", () => {
  const cases = [
    ["http-06", "</dev/null 2>/dev/null |"],
    ["linux-privesc-08", "<python3> -c 'print(open(\"/etc/shadow\").read())'"],
    ["active-directory-18", "-delegate-to '<TARGET_COMPUTER$>'"],
    ["windows-privesc-15", "Get-Acl HKLM:\\SOFTWARE\\<VENDOR> | Format-List"],
    ["windows-privesc-15", "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\<SERVICE>"]
  ];
  for (const [id, expected] of cases) {
    const step = stepById(id);
    assert.ok(step, id);
    const all = (step.commands || []).map(c => c.code).join("\n");
    assert.ok(all.includes(expected), `${id} must contain ${JSON.stringify(expected)}`);
  }
});

test("machine notes keep their template commands instead of empty blocks", () => {
  const page = pages.find(p => p.slug === "machine-notes");
  const codes = page.sections.flatMap(s => s.blocks.filter(b => b.type === "code").map(b => b.code));
  assert.ok(codes.includes("<command exactly as run>"));
  assert.ok(codes.every(c => c.trim().length > 0), "no source template block may be emptied");
  assert.ok(!/^\\+$/.test(stepById("machine-notes-01").title), "template heading keeps its text");
});

test("page-level blockquotes and provenance notes stay out of step fields", () => {
  // Defect: a trailing blockquote was absorbed into the last field, hiding the
  // PrintNightmare risk/cleanup text inside "Success path".
  for (const p of pages) {
    for (const s of p.sections) {
      for (const b of s.blocks) {
        if (b.type !== "step") continue;
        for (const [key, value] of Object.entries(b.fields || {})) {
          assert.doesNotMatch(value, /\s>\s\*\*/, `${b.id}.${key} still contains a blockquote`);
          assert.doesNotMatch(value, /Old page content preserved/, `${b.id}.${key} still contains a provenance note`);
        }
      }
    }
  }
  const be = stepById("bleeding-edge-12");
  assert.match(be.notes, /\*\*Risk:\*\*/);
  assert.match(be.notes, /\*\*Cleanup:\*\*/);
  assert.doesNotMatch(be.fields.success, /Cleanup/);
});

test("cross-references point at steps and pages that exist", () => {
  // Defect: the SSH page referenced a non-existent Step 13 after its reorder.
  for (const p of pages) {
    const numbers = new Set(p.sections.flatMap(s => s.blocks.filter(b => b.type === "step").map(b => String(b.n))));
    const max = Math.max(...[...numbers].map(Number));
    for (const s of p.sections) {
      for (const b of s.blocks) {
        if (b.type !== "step") continue;
        const text = [...Object.values(b.fields || {}), b.notes || ""].join("\n");
        for (const m of text.matchAll(/\bSteps?\s+(\d{1,2}[a-z]?)/g)) {
          // Cross-page references name another page first, so only flag a
          // number that is out of range for this page and appears alone.
          if (Number(m[1]) > max) {
            assert.fail(`${b.id} references Step ${m[1]} but ${p.slug} has ${max} steps`);
          }
        }
      }
    }
  }
  assert.match(stepById("nmap-15").fields.decision, /Complete Command Reference Step 04/);
  assert.equal(stepById("smb-02").fields.next, "Step 05 (null session).");
  assert.match(stepById("http-12").fields.next, /Step 04/);
  assert.doesNotMatch(stepById("nmap-18").fields.next, /batch|Database Services/);
});

test("service views without sidebar pages are reachable from the chip row", () => {
  // This is asserted in the browser suite as well; here we only confirm the
  // dataset still exposes the tags the row must render.
  const tagged = new Set(pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.type === "step").flatMap(b => b.tags || []))));
  for (const id of ["transfer", "fuzzing", "node", "exam", "notes", "troubleshooting"]) {
    assert.ok(tagged.has(id), `expected a ${id} service view`);
  }
});

/* ------------------------------------------------------------------ */
/* 2026-10-30 post-audit remediation (AUD-12 … AUD-18, status taxonomy) */
/* ------------------------------------------------------------------ */

test("AUD-12: the FTP script step separates confirmed, denied and inconclusive results", () => {
  const step = stepById("ftp-02");
  assert.ok(step, "ftp-02");
  const prose = [step.fields.lookFor, step.fields.failure, step.fields.decision, JSON.stringify(step.tables)].join("\n");
  assert.match(prose, /Anonymous FTP login allowed/, "the confirmed branch must be stated");
  assert.match(prose, /530/, "the denied branch must be stated");
  assert.match(step.fields.failure, /does not prove/i, "an empty script result must be called inconclusive");
  const commands = step.commands.map(c => c.code).join("\n");
  assert.match(commands, /curl[^\n]*ftp:\/\/anonymous/, "a manual anonymous check must ship with the step");
  assert.equal(step.tables.length, 1, "the three-way outcome table must be a real table block");
  assert.equal(step.tables[0].rows.length, 3);
});

test("AUD-13: the GenericAll step has an action and points back to the reset step", () => {
  const step = stepById("bloodhound-09");
  assert.ok(step, "bloodhound-09");
  assert.ok(step.commands.length >= 1, "the step must not be a dead end");
  assert.match(step.commands[0].code, /net rpc password/);
  assert.match(`${step.notes}\n${step.fields.next}`, /Step 08/);
});

test("AUD-14: every flagged tool has name, executable, package, privileges and compatibility", () => {
  const { tools } = read("tools.json");
  const byId = Object.fromEntries(tools.map(t => [t.id, t]));
  for (const id of ["sshpass", "testssl", "hakrawler", "katana", "certipy", "bloodyad", "impacket", "netexec", "ipmitool", "bloodhound-python"]) {
    assert.ok(byId[id], `${id} missing from the tool registry`);
    for (const key of ["name", "executable", "package", "install", "os", "privileges", "compat"]) {
      assert.ok(byId[id][key], `${id}.${key} is empty`);
    }
    assert.ok(byId[id].usedBy.length, `${id} must name the pages that use it`);
  }
  assert.equal(byId.netexec.executable, "nxc");
  assert.ok(byId.netexec.legacy.includes("crackmapexec"), "the deprecated name must stay documented");
  assert.match(byId.certipy.package, /certipy-ad/);
  assert.ok(byId.impacket.legacy.includes("secretsdump.py"));
  assert.ok(byId.impacket.binaries.includes("impacket-secretsdump"));
});

test("AUD-14: steps that need an uncommon tool say so and offer a way forward", () => {
  const cases = {
    "ssh-04": /sshpass/,
    "ftp-05": /lftp/,
    "http-07": /testssl\.sh/,
    "http-12": /hakrawler/,
    "active-directory-19": /certipy-ad/,
    "active-directory-20": /certipy-ad/,
    "bloodhound-13": /bloodyAD/,
    "other-services-11": /ipmitool/,
    "passwords-08": /best64\.rule/,
    "bleeding-edge-07": /impacket-rpcdump/,
    "bleeding-edge-18": /impacket-secretsdump/
  };
  for (const [id, re] of Object.entries(cases)) {
    const step = stepById(id);
    assert.ok(step, `${id} is missing`);
    assert.ok(step.fields.prereqs, `${id} has no Prerequisites line`);
    assert.match(step.fields.prereqs, re, `${id} prerequisites must name the tool`);
  }
});

test("AUD-17: filename placeholders and horizontal rules survive the export", () => {
  const step = stepById("machine-notes-01");
  assert.match(step.notes, /<filename>\.png/, "template placeholder must not be stripped as a tag");
  const page = pages.find(p => p.slug === "machine-notes");
  const proof = page.sections.flatMap(s => s.blocks)
    .find(b => b.type === "table" && b.headers?.includes("Screenshot"));
  assert.ok(proof, "the Proof table must exist as a table, not a paragraph of pipes");
  assert.ok(JSON.stringify(proof).includes("<file>.png"), "the screenshot cell keeps its placeholder");
  assert.ok(/\.png`/.test(JSON.stringify(proof)), "the cell must not lose both placeholder and extension");
  assert.equal(stepById("machine-notes-02").notes, "", "a horizontal rule is a separator, not a note");
});

test("AUD-18: PowerShell cmdlets are never labelled cmd", () => {
  const step = stepById("shells-15");
  const byLang = (lang) => step.commands.filter(c => c.lang === lang).map(c => c.code).join("\n");
  assert.match(byLang("cmd"), /certutil/);
  assert.doesNotMatch(byLang("cmd"), /Get-FileHash/);
  assert.match(byLang("powershell"), /Get-FileHash/);
  for (const p of pages) {
    for (const s of p.sections) {
      for (const b of s.blocks) {
        if (b.type !== "step") continue;
        for (const c of b.commands || []) {
          if (c.lang !== "cmd") continue;
          assert.doesNotMatch(c.code, /\b(Get-[A-Z]\w+|Invoke-WebRequest|New-Object)\b/, `${b.id} labels a cmdlet as cmd`);
        }
      }
    }
  }
});

test("verification status uses the five-level vocabulary everywhere", () => {
  const allowed = ["Lab Tested", "Simulated", "Syntax Checked", "Environment Dependent", "Documented"];
  assert.deepEqual(read("meta.json").statuses, allowed);
  for (const p of pages) {
    for (const s of p.sections) {
      for (const b of s.blocks) {
        if (b.type !== "step") continue;
        assert.ok(allowed.includes(b.status), `${b.id}: ${b.status}`);
      }
    }
  }
  const envSteps = steps.filter(s => s.status === "Environment Dependent");
  assert.ok(envSteps.length >= 5, "environment-dependent steps must be labelled, not left generic");
  for (const s of envSteps) assert.ok(s.fields.prereqs, `${s.id} is Environment Dependent without a prerequisite line`);
});

test("the generated tool reference lists every tool and all five statuses", () => {
  const page = pages.find(p => p.slug === "tool-reference");
  assert.ok(page, "tool-reference page is missing");
  assert.equal(page.stepCount, 0);
  assert.equal(page.generated, true);
  const rows = page.sections.flatMap(s => s.blocks).filter(b => b.type === "table").flatMap(t => t.rows);
  assert.ok(rows.length >= 40, `only ${rows.length} tool rows`);
  for (const tool of read("tools.json").tools) {
    assert.ok(rows.some(r => r[1].includes(tool.executable)), `${tool.id} is missing from the tool table`);
  }
  const legend = page.sections.find(s => s.id === "tool-reference-status").blocks.find(b => b.type === "table");
  assert.deepEqual(legend.rows.map(r => r[0]), ["Lab Tested", "Simulated", "Syntax Checked", "Environment Dependent", "Documented"]);
});
