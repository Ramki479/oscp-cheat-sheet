import test from "node:test";
import assert from "node:assert/strict";
import {
  applyVariables, buildAliasIndex, matchesQuery, filterBlocks,
  serviceGroups, isValidToken, findStep, countSteps
} from "../assets/engine.js";

const variables = [
  { token: "TARGET_IP", aliases: [] },
  { token: "SHARE_NAME", aliases: ["SHARE"] },
  { token: "PASSWORD", aliases: [] }
];
const aliases = buildAliasIndex(variables);

test("replaces an exact token", () => {
  const r = applyVariables("nmap -sV <TARGET_IP>", { TARGET_IP: "10.10.10.10" }, aliases);
  assert.equal(r.text, "nmap -sV 10.10.10.10");
  assert.deepEqual(r.missing, []);
});

test("does not replace a prefix inside another token", () => {
  const r = applyVariables("<TARGET> <TARGET_IP>", { TARGET_IP: "10.0.0.1" }, aliases);
  assert.equal(r.text, "<TARGET> 10.0.0.1");
  assert.deepEqual(r.missing, ["TARGET"]);
});

test("fills an alias from its canonical value", () => {
  const r = applyVariables("mount //t/<SHARE>", { SHARE_NAME: "backups" }, aliases);
  assert.equal(r.text, "mount //t/backups");
  assert.deepEqual(r.missing, []);
});

test("keeps unresolved placeholders and reports them", () => {
  const r = applyVariables("smbclient -U <USERNAME> -p <PASSWORD>", {}, aliases);
  assert.equal(r.text, "smbclient -U <USERNAME> -p <PASSWORD>");
  assert.deepEqual(r.missing.sort(), ["PASSWORD", "USERNAME"]);
});

test("treats empty values as missing", () => {
  const r = applyVariables("<TARGET_IP>", { TARGET_IP: "" }, aliases);
  assert.equal(r.text, "<TARGET_IP>");
  assert.deepEqual(r.missing, ["TARGET_IP"]);
});

test("preserves special characters verbatim", () => {
  const value = "p@ss&w0rd \"quoted\" $HOME `id`";
  const r = applyVariables("echo <PASSWORD>", { PASSWORD: value }, aliases);
  assert.equal(r.text, `echo ${value}`);
});

test("replaces every occurrence", () => {
  const r = applyVariables("<TARGET_IP> <TARGET_IP> <TARGET_IP>", { TARGET_IP: "1.2.3.4" }, aliases);
  assert.equal(r.text, "1.2.3.4 1.2.3.4 1.2.3.4");
});

test("token validator rejects lowercase and empty names", () => {
  assert.equal(isValidToken("LHOST"), true);
  assert.equal(isValidToken("NEW_VAR_2"), true);
  assert.equal(isValidToken("lhost"), false);
  assert.equal(isValidToken(""), false);
  assert.equal(isValidToken("2VAR"), false);
});

const step = (over = {}) => ({
  type: "step", id: "smb-01", n: "01", title: "List shares", priority: "Core",
  status: "Syntax Checked", runOn: "kali", tags: ["smb"],
  commands: [{ lang: "bash", code: "smbclient -L <TARGET_IP>" }],
  fields: { lookFor: "share names", decision: "enumerate", next: "", mistake: "", evidence: "" },
  notes: "", tables: [], ...over
});

test("search is multi-word and case-insensitive", () => {
  assert.equal(matchesQuery(step(), "LIST shares", "SMB"), true);
  assert.equal(matchesQuery(step(), "shares ftp", "SMB"), false);
  assert.equal(matchesQuery(step(), "smbclient", "SMB"), true);
  assert.equal(matchesQuery(step(), "", "SMB"), true);
});

test("search indexes extended decision fields", () => {
  const extended = step({
    fields: {
      purpose: "recover an encrypted key passphrase",
      prereqs: "authorised key file",
      lookFor: "john output",
      success: "passphrase recovered",
      failure: "wordlist exhausted",
      decision: "stop after one targeted attempt",
      next: "connect with the key",
      mistake: "", evidence: ""
    }
  });
  assert.equal(matchesQuery(extended, "encrypted passphrase", "SSH"), true);
  assert.equal(matchesQuery(extended, "wordlist exhausted", "SSH"), true);
  assert.equal(matchesQuery(extended, "unrelated", "SSH"), false);
});

test("priority and status filters compose", () => {
  const blocks = [step(), step({ id: "smb-02", priority: "Conditional" })];
  assert.equal(filterBlocks(blocks, { priority: "Core" }).length, 1);
  assert.equal(filterBlocks(blocks, { status: "Documented" }).length, 0);
  assert.equal(filterBlocks(blocks, { status: "Environment Dependent" }).length, 0);
  assert.equal(filterBlocks(blocks, { priority: "Core", status: "Syntax Checked" }).length, 1);
});

test("service groups only include tagged steps and skip empty pages", () => {
  const pages = [
    { slug: "a", sections: [{ title: "S", blocks: [step(), step({ id: "a-02", tags: ["ftp"] })] }] },
    { slug: "b", sections: [{ title: "T", blocks: [step({ id: "b-01", tags: ["nfs"] })] }] }
  ];
  const groups = serviceGroups(pages, "smb");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].page.slug, "a");
  assert.equal(groups[0].groups[0].steps.length, 1);
});

test("findStep walks pages and sections", () => {
  const pages = [{ slug: "a", sections: [{ title: "S", blocks: [step()] }] }];
  assert.equal(findStep(pages, "smb-01").step.n, "01");
  assert.equal(findStep(pages, "nope"), null);
  assert.equal(countSteps(pages), 1);
});
