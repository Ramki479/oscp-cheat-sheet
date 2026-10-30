# OSCP Cheat Sheet — Post-Audit Remediation & Validation

**Date:** 2026-10-30
**Predecessor:** `audit/OSCP-EXAM-READINESS-AUDIT-2026-10-29.md` (left untouched)
**Scope:** close AUD-12, AUD-13, AUD-14, AUD-17 and AUD-18; add a central tool reference;
introduce a visible five-level verification status; re-verify the build; prepare — not
execute — AD/Windows lab validation.

---

## 1. Findings fixed

### AUD-12 — FTP cannot tell "anonymous denied" from "script said nothing" (Medium)

`ftp-02` now separates three outcomes instead of two:

| Result | Meaning | Route |
| --- | --- | --- |
| `Anonymous FTP login allowed` | confirmed | Step 03 → Step 04 |
| `Anonymous FTP login denied`, or the manual check prints `530` | refused | Step 06 with credentials |
| No `ftp-anon` line, and no `230`/`530` from the manual check | **inconclusive** | investigate the trace; only a refusal closes the path |

The step gained a `Failure path` that says an empty result "does not prove" anonymous is
off, plus a second command that verifies by hand:

```bash
curl -sS --max-time 10 -v ftp://anonymous:anonymous@<TARGET_IP>/ 2>&1 | grep -E '^< (220|230|530)'
```

**Executed** against an isolated pyftpdlib server (section 4). The three-way table is a real
table block, so it survives the parser and renders as a table.

### AUD-13 — BloodHound GenericAll was a dead end (Medium)

`bloodhound-09` now carries the reset command (the Step 08 command, explicitly attributed),
a `Look for`, and `Next: Step 06 (re-mark owned and re-collect) or Step 08 if the reset is
refused`. Verified in the browser: the step has a copyable block and the text "Step 08".

### AUD-14 — Tool name, executable and package drift (Medium)

Two-part fix, no blind replacement:

1. **A central tool reference** — `#/p/tool-reference`, generated from
   `content/tool-registry.json` (87 tools, 7 categories). Each row: display name, executable,
   legacy/alternative names, install package and install line, OS, required privileges,
   version/compatibility caveats, and the pages that use it. Usage is derived from the
   commands themselves (`tools/parse.mjs`), so the table cannot drift from the pages.
2. **Per-step recovery lines** for every flagged tool, in the step's own `Prerequisites`
   field: `sshpass` (ssh-04), `lftp` (ftp-05), `testssl.sh` (http-07), `hakrawler`/`katana`
   (http-12), `certipy-ad`/`certipy` (active-directory-19/20), `bloodyAD` (bloodhound-13),
   `ipmitool` (other-services-11), hashcat rule files (passwords-08), and the Impacket
   wrapper/legacy-name equivalence in bleeding-edge-03/05/07/09/13/14/18/21.

Deliberate non-changes, because the legacy forms still work where they are installed:

- `crackmapexec` in `bleeding-edge-19` is kept as a commented legacy alternative beside the
  `nxc` primary command (both binaries exist on this host; CME is deprecated, not broken).
- Legacy Impacket `.py` names stay in the commands (source provenance), with the wrapper name
  and arguments documented in the same step and in the registry.

### AUD-17 — Machine-notes template cosmetics (Low)

- `<filename>.png` and `<file>.png` are no longer stripped as HTML tags: a lowercase
  placeholder followed by a file extension is masked before tag stripping.
- A standalone `---` is a page separator, not step content: horizontal rules are dropped from
  step notes.
- **Root cause found while fixing these:** 45 Markdown pipe tables in the export were never
  converted, so they rendered as one paragraph of pipes with empty cells (`| Field | Value | |
  --- | --- |`). The table the audit called "a `<code>` cell" was in fact not a table at all.
  The parser now converts pipe tables (with header row) into table blocks before field
  parsing; 69 table blocks render, 0 paragraphs begin with a pipe.

### AUD-18 — PowerShell labelled `cmd` (Low)

`shells-15` split into a `cmd` fence (`certutil -hashfile`) and a `powershell` fence
(`Get-FileHash`). A dump of every `cmd` fence confirms no cmdlet remains under a `cmd` label.
`other-services-12` was re-inspected: its fences are a Linux shell block and a REPL `text`
block, which is correct — no change needed.

### New: five-level verification status

The dataset, engine, validator, filter and badges now use exactly:

| Status | Meaning | Steps |
| --- | --- | --- |
| `Lab Tested` | executed against an authorised lab target with recorded output | 0 |
| `Simulated` | exercised with simulated output or fixtures | 0 |
| `Syntax Checked` | flags/quoting checked against the installed tool | 241 |
| `Environment Dependent` | needs a specific tool, version or host configuration | 8 |
| `Documented` | standard technique, not run here | 72 |

The legend is on the tool-reference page and in the page intros of Nmap, SMB, FTP, DNS, HTTP,
SSH and Active Directory. `meta.statuses` is validated; the browser filter offers all five and
filters correctly (`0 of 21 steps` on SMB for `Environment Dependent`).

`Environment Dependent` was applied only where a specific missing dependency exists —
`ftp-05`, `http-07`, `http-12`, `ssh-04`, `active-directory-19`, `active-directory-20`,
`bloodhound-13`, `passwords-08` — and every one has a `Prerequisites` line naming it. Both new
tiers that were not used (`Lab Tested`, `Simulated`) stay at zero rather than being invented.

### Also fixed

- `bleeding-edge-13` said "`certi` can locate it" (truncated export) → `certipy find`.
- README counts, status vocabulary and test inventory corrected.

---

## 2. Files changed

| Area | Files |
| --- | --- |
| Content (source export) | `content/raw/{ftp,bloodhound,ssh,http,active-directory,passwords,other-services,shells,bleeding-edge,nmap,smb,dns}.html` + the label migration in `content/raw/*.html` |
| New curated data | `content/tool-registry.json` |
| Build | `tools/parse.mjs` (statuses, pipe tables, filename placeholders, horizontal rules, tool inventory, generated page), `tools/validate.mjs` |
| UI | `assets/engine.js` (STATUS_ORDER), `assets/app.js` (status classes), `assets/app.css` (badges), `sw.js` (cache v8) |
| Generated | `data/commands.json`, `data/variables.json`, `data/meta.json`, `data/tools.json` (new), `tools/parse-report.txt` |
| Tests | `tests/data.test.mjs`, `tests/engine.test.mjs`, `tests/browser.test.mjs`, `tests/audit-regression.test.mjs` (+8 tests) |
| Audit tooling | `audit/scripts/fence-diff.mjs` (skips generated pages), `audit/scripts/post-remediation-browser.mjs` (new) |
| Evidence | `audit/evidence/post-remediation-ftp.txt`, `audit/evidence/post-remediation-browser.txt` |
| Documents | this report, `audit/AD-WINDOWS-LAB-VALIDATION-PLAN.md` |

No repository reset, no commit, no change outside `oscp-cheat-sheet/`. Lab services started
for the FTP check were stopped afterwards.

---

## 3. Regression results

| Check | Before | Now |
| --- | --- | --- |
| `npm test` | 57/57 | **65/65** |
| `npm run validate` | OK | **OK** |
| Source fences vs generated data | 355/355 | **358/358** (byte-for-byte) |
| `bash -n` on bash-family blocks | 277 checked, 0 real failures | **279 checked, 0 real failures** (2 template placeholders fail by design) |
| Pages / steps / commands | 24 / 321 / 318 | **25 (24 + generated) / 321 / 321** |
| Table blocks | 24 HTML only | **69** (24 HTML + 45 Markdown) |
| Paragraphs that start with a pipe | 45 | **0** |
| Browser console / page / request errors | 0 | **0** |
| External requests | 0 | **0** |
| Horizontal page overflow (1440 / 1024 / 390) | 0 | **0** |
| Steps marked `Lab Tested` | 0 | **0** |

Per-page step counts are unchanged on all 21 command pages (nmap 25, smb 21, ftp 12, dns 9,
http 16, ssh 12, other-services 12, active-directory 25, bleeding-edge 23, bloodhound 14,
post-exploitation 20, passwords 12, linux-privesc 21, windows-privesc 19, directory-vhost 17,
shells 15, tunneling 11, exploit-research 14, machine-notes 2, exam-execution 12,
troubleshooting 9), which is the evidence that unrelated pages were not disturbed.

New regression tests (all in `tests/audit-regression.test.mjs`): FTP three-way branch,
BloodHound actionability, tool-registry completeness, per-step prerequisite coverage for the
nine flagged tools, `<filename>.png` and `<hr>` handling, cmd/PowerShell labelling across every
fence, the five-level vocabulary (including "no Environment Dependent step without a
prerequisite"), and the generated tool page's completeness.

Browser checks run with Puppeteer/Chromium (evidence in
`audit/evidence/post-remediation-browser.txt`): FTP step (2 code blocks, 3-row table, failure
field), BloodHound step (command + Step 08 pointer),tool reference (8 tables, **87 tool rows** — 14/5/9/13/5/19/22 by category — plus the five-status legend, reachable from the sidebar), status filter options, and
machine-notes (7 tables, `<file>.png` intact, 0 pipe paragraphs). Tool-reference layout:
0 px overflow at 1440 and 390 px, 7 of 8 tables scroll internally on a phone.

---

## 4. FTP and BloodHound test evidence

### FTP (AUD-12) — executed

Isolated loopback lab: `pyftpdlib 2.2.0` serving an anonymous root on `127.0.0.1:2121`
containing `sub/app.conf`. Full transcript in `audit/evidence/post-remediation-ftp.txt`.

| Run | Result |
| --- | --- |
| `nmap -p2121 --script ftp-anon,ftp-syst 127.0.0.1` | port open, **no `ftp-anon` line** — the AUD-12 defect reproduced |
| `curl -sS --max-time 10 -v ftp://anonymous:anonymous@127.0.0.1:2121/ \| grep '^< (220\|230\|530)'` | `< 230 Login successful.` → confirmed branch |
| same check with `nobody:wrong` | `< 530 Authentication failed.` → denied branch |
| `curl … ftp://anonymous:anonymous@127.0.0.1:2121/` | directory listing returned |

The site's command is written for port 21; the lab run used `:2121`, which is the only
adaptation. The step's label stays `Syntax Checked` — one lab run does not upgrade it, and the
site does not upgrade labels without a recorded result for the step.

### BloodHound (AUD-13) — rendered, not executed

No domain controller exists in this environment, so the reset command was **not** run. What
was verified is that the step is no longer a dead end: one copyable command, a Look for, a
Decision that routes to Step 05/06, and a Next that names Step 08 as the fallback. The command
itself remains unexecuted, and the step stays `Syntax Checked`.

---

## 5. Tool-name consistency results

| Tool | Resolution |
| --- | --- |
| NetExec | executable `nxc`, package `netexec` (pipx); `crackmapexec` documented as the deprecated legacy name |
| CrackMapExec | kept as a working alternative in `bleeding-edge-19`, marked deprecated; both binaries present here |
| Impacket | wrappers `impacket-<module>` on Kali/Debian; 18 legacy `.py` names documented with "same arguments"; per-step recovery lines added |
| Certipy | package `certipy-ad`, executable `certipy`, v4/v5 flag drift called out; not installed here |
| bloodyAD | `pipx install bloodyAD`; renamed from `bloodyAD.py`; not installed here |
| testssl.sh | `apt install testssl.sh` or git checkout; `sslscan` is installed and was checked |
| hakrawler / katana | Go installs, not packaged; documented as absent |
| sshpass | separate package, not in a minimal install; not installed here |
| lftp | optional, `apt install lftp`; ftp/wget alternatives named |
| ipmitool | `apt install ipmitool`; probe needs only nmap |
| hashcat rules | `hashcat-data`; `best64.rule` genuinely absent here while 29 other rules exist — step now says to check the directory |
| Get-Acl / Get-FileHash | labelled PowerShell cmdlets, not cmd.exe built-ins |
| `net` | documented as two different tools (Windows built-in vs Samba client) |

Registry coverage: 87 rows, every row used by at least one step and pointing at a page that
exists (validated on every build). The residual command words that are not registry rows are
enumerated on the page itself: shell/base utilities, Windows built-ins, `rpcclient`
subcommands, SQL, Cypher and msfconsole commands.

Verification of the earlier audit's assumptions found two corrections: `sslscan` **is**
installed here (the previous "not tested" note was inherited, not observed), and
`crackmapexec` **is** installed although deprecated. Both are reflected in the registry rather
than repeated.

---

## 6. Remaining limitations

1. **Still no `Lab Tested` and no `Simulated` step.** Everything AD, Windows, Kerberos,
   delegation, ADCS, relay, payload and credential-dumping remains unexecuted. This report
   does not upgrade a single step.
2. **The AD/Windows evidence gap is unchanged.** It is now planned in detail
   (`audit/AD-WINDOWS-LAB-VALIDATION-PLAN.md`) but plans are not evidence.
3. **Tool versions drift faster than the text.** `msfvenom` payload/encoder names, Certipy v4
   vs v5 flags and SharpHound/BloodHound CE defaults are documented as caveats, not tested.
4. **Tool usage is derived heuristically** from command words (plus a name match in step text
   for tools invoked through `python3` or a GUI). A tool used only inside a script or an alias
   would not be attributed.
5. **The source export is no longer byte-identical to Notion.** Raw HTML was edited for the
   second time (statuses, prerequisites, one split fence, one typo). The changes are itemised
   above and covered by the fence-fidelity test, but the export is now a maintained document,
   not a frozen snapshot.
6. **Chromium only.** No Firefox/Safari pass; the Vercel/HTTPS deployment path is still
   untested.
7. **Status labels describe this build, not your lab.** `Syntax Checked` means the flags were
   checked against the installed tool on the audit host.

---

## 7. AD/Windows lab validation plan

See `audit/AD-WINDOWS-LAB-VALIDATION-PLAN.md`. It defines an isolated topology (DC, member
server, workstation, Kali), the seeded AD misconfigurations, the tool baseline to record, a
JSON evidence schema, and eight workflows — AD enumeration, Kerberos, BloodHound, Windows
privesc, ADCS/Certipy, SMB credential validation, relay, post-access enumeration — each with
prerequisites, exact commands, expected evidence, a **required negative test**, a recovery
branch and cleanup. It also states the rule for promotion: a step becomes `Lab Tested` only
when a recorded run supports it, and only after the negative branch has been exercised.

---

## 8. Readiness verdict

**Limited Lab Trial — unchanged, and deliberately so.**

Why the verdict does not move up:

- The target set for this milestone was "all remaining findings closed **and** at least one
  complete Windows/AD workflow demonstrated in a real isolated lab". The first half is done;
  the second half was not possible here — there is no domain controller or Windows host in
  this environment, and inventing one from documentation is exactly what the audit forbids.
- No step is `Lab Tested`. The highest-stakes paths (AD, Windows, relay, payloads, credential
  dumping) are still `Documented`, and the new taxonomy makes that visible on every step
  instead of hiding it behind a single vague label.

Why it is a materially better build than the 2026-10-29 baseline:

- All five open findings are closed, including the two workflow dead ends, with regression
  tests that fail if they come back.
- A 45-table rendering defect that the previous audit missed was found and fixed; the site
  no longer shows pipe text where a table should be.
- Tool drift is now answerable in one place, with the package, the executable and the legacy
  name in the same row, and the pages that depend on it derived automatically.
- Verification level is a first-class, filterable property of every step, with a legend that
  explains what each level required — and the two levels that have no evidence stay at zero.
- 65/65 tests, validation clean, 358/358 fences byte-identical, 0 console/network errors,
  0 external requests.

**Bottom line for an exam candidate:** the Nmap, SMB, HTTP/HTTPS, SSH, DNS, FTP, content
discovery and Linux-triage pages are the parts you can lean on. Treat every AD, Windows,
Kerberos, ADCS, relay, payload and credential-dumping step as a lead to confirm in your own
lab; the site now tells you exactly which tool to install, what the modern executable is
called, and how little has been proven.
