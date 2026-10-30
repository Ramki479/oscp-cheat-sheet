# OSCP Cheat Sheet — Exam-Readiness Audit

**Audit date:** 2026-10-29
**Target:** `~/oscp-cheat-sheet` (static site; no git repository at audit time)
**Auditor role:** penetration-testing instructor / web QA / command validation
**Baseline preserved at:** `/tmp/oscp-baseline/` (data, tools, tests, content, assets)

---

## A. Executive summary

The site is a well-structured, honest command reference: all 24 pages render, navigation and
hash routes work, variable substitution and copy behave correctly, there are no console errors,
no failed requests and no third-party calls, and no command falsely claims `Lab Tested`.

It was **not** exam-ready at the start of the audit. Four high-severity defects were reproduced:

1. The parser stripped anything that looked like an HTML tag **inside code fences**, corrupting
   real commands (`</dev/null` → `/dev/null`, `<TARGET_COMPUTER$>` → empty, `<python3>` →
   blank). One of those commands fails on contact with OpenSSL; another is not a shell command
   at all.
2. Windows registry commands lost every backslash (`HKLM:\SOFTWARE\...` →
   `HKLM:SOFTWARE...`), making the PowerShell invalid.
3. The SSH page pointed at a **Step 13 that does not exist** after its workflow reorder.
4. Seven command blocks mixed two execution contexts (MySQL prompt, `mssqlclient`, Node
   inspector REPL, Linux/Windows/PowerShell) and failed when copied as labelled.

All four are fixed, with regression tests. Twelve further medium/low defects were fixed
(wrong cross-references, blockquote/warning text trapped inside fields, Markdown rendered in
step headings, six service views unreachable from the UI, indistinguishable alternatives,
silent wrong-page routing, "unspecified" badges, template text loss).

**Readiness verdict: Limited Lab Trial** (see J). The fixed build is safe for restricted lab
use. It is not a Broader Release Candidate because no command has been executed against a real
exam target, and Windows/AD/exploitation paths could only be simulated or syntax-reviewed.

| Measure | Baseline | After fixes |
| --- | --- | --- |
| `npm run validate` | OK | OK |
| `npm test` | 46/46 pass | **57/57 pass** |
| Fences matching generated data | 348 fences / 346 blocks (10 missing, 8 altered) | **355/355** |
| Bash blocks failing `bash -n` | 4 real + 2 template placeholders | **0 real** (2 template placeholders) |
| Browser console/network errors | 0 | 0 |
| Services reachable from chip row | 26 of 32 | **32 of 32** |
| Commands marked `Lab Tested` | 0 | 0 |

The site does **not** guarantee OSCP success, and this audit does not certify every command.
Status labels must still be read literally.

---

## B. Website inspection report

### Coverage

All 24 source pages were loaded in headless Chromium at 1440×1000, 1024×768 and 390×844.
Every page rendered its expected number of steps (no empty page, no duplicate step IDs):

```
nmap 25 · smb 21 · ftp 12 · dns 9 · http 16 · ssh 12 · other-services 12
active-directory 25 · bleeding-edge 23 · bloodhound 14 · post-exploitation 20
passwords 12 · linux-privesc 21 · windows-privesc 19 · directory-vhost 17
shells 15 · tunneling 11 · exploit-research 14 · machine-notes 2
exam-execution 12 · troubleshooting 9 · workflow/reference pages 0 steps (by design)
```

32 service views exist. All 32 are now present in the chip row; before the fix only 26 were
(File Transfer, Content Discovery, Node Inspector, Exam, Notes and Troubleshooting appeared
only if you typed `#/s/<id>` yourself).

### Navigation and routing

- 24 sidebar page links, all open and return correctly.
- Hash routes work on direct load and refresh (`#/p/smb`, `#/s/nfs`).
- Back/forward restores the previous page (`SMB → FTP → back → SMB → forward → FTP`).
- Sidebar highlights the active page; the service chip highlights the active service.
- **Defect fixed:** an unknown in-app hash (`#/p/does-not-exist`) used to render Nmap while the
  URL still said `#/p/does-not-exist`. It now falls back to the SMB service. A direct refresh
  always fell back correctly; only the `hashchange` path was wrong.
- Search: multi-word, case-insensitive (`smb signing` → 6 hits), with a useful empty state.
  Search results jump to the step.
- Filters: priority/status compose and report `x of y steps`; reset appears only when active.
- No unlabelled buttons or inputs (checked in the rendered DOM).

### Command presentation

- Commands are ordered by the source workflow, numbered, with priority, execution host and
  status badges.
- Primary commands and alternatives are visually identical except for the priority badge and
  the word "Alternative" in the title. **Fixed:** branch steps now carry an `ALTERNATIVE`
  badge.
- Long commands scroll inside their block; the document itself never overflows horizontally
  (0 px at 1440/1024/390). At 390 px, 24 code blocks are individually scrollable.
- Copy copies the rendered command, never the `<TOKEN>` template, and never an explanation.
  Captured output blocks have **no copy button** and are not substituted (21/21 on Bleeding
  Edge; the `<SNIP>` redaction stays literal).
- **Fixed:** five step headings rendered raw Markdown
  (`[psexec.py](http://psexec.py) (SYSTEM, noisy)`) and one rendered backticks. Headings are
  now plain text.
- **Fixed:** seven blocks mixed contexts under one `bash` label. They are now one fence per
  context (`bash`, `sql`, `text`, `powershell`, `cmd`), so copying a block cannot interleave
  a MySQL statement with a shell command.
- Windows blocks were labelled `bash` because the export used a `shen` fence. They are now
  labelled `cmd`.
- **Remaining (Medium):** a few steps still have no command and no pointer to the step that
  contains it (see AUD-13).

### Variable handling (tested in the browser)

| Test | Result |
| --- | --- |
| `TARGET_IP=10.10.10.10` updates every command on the page | Pass |
| Invalid `10.10.10.10.10` stays visible, marks `aria-invalid=true`, shows an inline error, and is **not** substituted | Pass |
| Unresolved tokens stay literal and are listed under the command (`Missing values: <TARGET_IP>`) | Pass |
| Copy with unresolved tokens still copies, and the toast names the tokens | Pass |
| Changing one variable does not change unrelated variables | Pass (engine unit tests) |
| Special characters are inserted verbatim, with no shell quoting | Pass by design; documented |
| Output blocks / prose examples are not substituted | Pass |
| Copy uses the rendered command | Pass |
| Pinned values propagate to the drawer and back | Pass |

A literal unresolved token in a real shell does not degrade gracefully:
`nmap -sCV -p139,445 <TARGET_IP>` is a **bash syntax error** (`unexpected token 'newline'`).
The UI's missing-value banner is therefore the primary safety net, and it works.

### Technical reliability

- 0 console errors, 0 page errors, 0 failed requests, 0 external requests across the audit.
- Service worker installs and serves the app offline after the first visit.
- `sw.js` cache version bumped to `v7` for this release.
- Data validation passes: 24 pages, 321 steps, 318 command blocks, 59 variables; all command
  tokens registered; all service tags registered; no Notion links, no `Related pages`, no
  `Quick navigation` leftovers.
- All 355 source fences now map 1:1 to generated blocks (byte-for-byte after trailing-newline
  normalisation).

---

## C. Command accuracy report

### How commands were checked

1. **Static extraction** of all 318 command blocks and 21 output blocks.
2. **Shell syntax checking**: every `bash`-family block (`277` after excluding templates) was
   rendered with representative variables and passed through `bash -n`. This validates parse
   structure only, never that the command achieves its goal.
3. **Local execution** against isolated localhost services: Samba (445/139), OpenSSH (22),
   a Python HTTP server, `pyftpdlib` (2121), `dnsmasq` (5353) and `openssl s_server` (8443).
   No traffic left the host; no sudo, no `/etc/hosts` edits, no exploit execution.
4. **Tool contract checks** with the installed binaries (`nmap 7.99`, `nxc 1.5.1`,
   `smbclient/Samba 4.24.5`, Impacket modules, `openssl 3.6.3`, `smbmap 1.10.7`,
   `ffuf 2.1.0-dev`, `whatweb 0.6.4`, `nikto 2.6.0`, `hashcat 7.1.2`).
5. **Source-to-data comparison** for every fence, including whitespace and redactions.

### Verified (executed locally with the documented effect)

| Step | What was run | Result |
| --- | --- | --- |
| `nmap-01` | `ip a`, `ip route get`, `ping -c 3` | Confirmed loopback interface/route/ICMP |
| `nmap-02` | `mkdir -p <OUTPUT_DIR> && cd` | Directory created |
| `nmap-03` | `nmap -sn 127.0.0.1/24 -oN` | Sweep completed, host list written |
| `nmap-04` (adapted) | non-root `nmap -sT -p1 127.0.0.1` | Closed port reported correctly; the shipped `-sS` could not run without sudo |
| `smb-01` | `nmap -sCV -p139,445 127.0.0.1` | Samba 4.24.5, signing state |
| `smb-02` | SMB NSE baseline | `smb2-security-mode`: signing enabled but not required |
| `smb-03` | `smb2-security-mode,smb2-capabilities` | Dialects 2.0.2–3.1.1, signing line |
| `smb-05` | `smbclient -N -L //127.0.0.1/` | Share table (APPS, print$, IPC$) |
| `smb-06` | `smbmap -H 127.0.0.1 -u '' -p ''` | Permission map produced |
| `smb-07` | `nxc smb ... -u '' -p '' --shares` | Null auth, `READ,WRITE` on APPS |
| `http-02` | `whatweb -a 1 http://127.0.0.1:8124/` | Python SimpleHTTP identified |
| `http-03` | `curl -i -sS` | Headers and body returned |
| `http-04` | curl status/size loop | 200/404/size differential |
| `http-05` | robots/sitemap/asset grep | Asset list extracted |
| `http-06` (after fix) | `openssl s_client ... </dev/null ... \| openssl x509` | `subject=CN=corp.local`, exit 0 |
| `directory-vhost-03` | `ffuf ... -mc 200,... -ac` | Found `index.html`, `data`, `assets/app.js` |
| `directory-vhost-04` | `gobuster dir` | Same hits |
| `ftp-01` | `nmap -sCV -p2121 127.0.0.1` | Port open, service detected |
| `ftp-02` | `nmap --script ftp-anon,ftp-syst,...` | **No output** although anonymous login worked (AUD-12) |
| `ftp-07` | `wget -m ftp://anonymous:anonymous@...` | Tree mirrored |
| `ftp-09` | `find -exec file`, credential grep | `sub/app.conf` contained a password |
| `ssh-01` | `nmap -sV -p22 127.0.0.1` | OpenSSH banner |
| `ssh-02` | `ssh -o PreferredAuthentications=none` + NSE | `Permission denied (publickey,password)`; script agrees |
| `ssh-10` | `nmap --script ssh2-enum-algos` | Algorithm list |
| `ssh-03` | `ssh -v` | Authentication stages in the trace |
| `dns-02/03/05` | `dig` against local dnsmasq on :5353 | A record returned; AXFR refused |
| `linux-privesc-01` | `id; whoami; sudo -l; sudo -V` | Identity and sudo version; `sudo -l` cannot prompt without a TTY (the step warns about this) |
| `linux-privesc-04` | `find / -perm -4000` | SUID list |
| `linux-privesc-07` | `getcap -r /` | Capability list |
| `linux-privesc-09` | cron/timers | Readable cron configuration |
| `linux-privesc-11` | identity-file permissions | Modes reported |

### Syntax-checked, not executed

The remaining bash-family commands (277 total checked) pass `bash -n` with representative
values. This group includes destructive or privileged operations (`secretsdump`, `psexec`,
`ntlmrelayx`, `msfvenom`, `nc` listeners, kernel exploits, `/etc/passwd` writes). Their syntax
is plausible; their effect is **not** verified here.

### Incorrect (reproduced, now fixed)

| Step | Defect | Evidence |
| --- | --- | --- |
| `http-06` | Shipped command lost `</dev/null 2>/dev/null`, becoming `... /dev/null \| ...`; OpenSSL fails with `cannot provide both -connect option and target parameter` | `audit/evidence/scenario-runs.json` (S09); fixed form returns exit 0 (`post-fix-verification.txt`) |
| `linux-privesc-08` | `<python3>` was stripped, leaving `  -c 'print(...)'`; shell reports `-c: command not found` (exit 127) | `scenario-runs.json` S09 |
| `active-directory-18` | `-delegate-to ''` (target computer token stripped); `impacket-rbcd` requires a value for `-delegate-to` | `post-fix-verification.txt`, `impacket-rbcd -h` |
| `windows-privesc-15` | `Get-Acl HKLM:SOFTWARE<VENDOR>` and `HKLM:SYSTEMCurrentControlSetServices<SERVICE>` are invalid PowerShell (no separators) | Source + generated data before fix; `pwsh` unavailable, so corrected form is syntax-reviewed only |

### Environment-dependent / unverified

| Area | Issue | Status |
| --- | --- | --- |
| Impacket naming | Some steps use `secretsdump.py`, `smbserver.py`, `rpcdump.py`, `ntlmrelayx.py`; on this Kali only `impacket-*` wrappers exist | **Environment-dependent** |
| `crackmapexec` | `bleeding-edge-19` uses CME while the rest of the site standardises on `nxc`; CME is deprecated | **Environment-dependent** |
| `sshpass` (`ssh-04`) | Not installed here and not listed as a prerequisite | **Not tested** |
| `lftp` (`ftp-05`) | Not installed; the step does mention installing it | **Not tested** |
| `hakrawler` / `katana` (`http-12`) | Neither installed; no prerequisite note | **Not tested** |
| `testssl.sh` (`http-07`), `certipy` (`active-directory-19/20`) | `testssl.sh` absent; only `certipy-ad` is installed | **Environment-dependent** |
| `ipmitool` (`other-services-11`), `bloodyAD` (`bloodhound-13`, `AD-15`) | Absent; steps already flag this | **Not tested** |
| Windows/AD execution | No domain controller or Windows host was available; all AD/Kerberos/Windows commands are simulated or syntax-reviewed | **Not tested** |
| `msfvenom`/Metasploit | Not executed; payload generation and handler behaviour unverified | **Not tested** |
| `hashcat` rule path | `/usr/share/hashcat/rules/best64.rule` is absent on this host | **Environment-dependent** |

### Label integrity

- 242 `Syntax Checked`, 79 `Documented — Untested`, 0 `Lab Tested` (unchanged).
- 19 steps intentionally have no command (checklists, reading steps, templates).
- No status was upgraded by this audit. Locally executed steps remain labelled honestly as
  `Syntax Checked`; the site's label describes the build's evidence, not this host's run.

---

## D. Scenario test report

All scenarios use fictional addresses (`10.10.10.0/24`, `10.10.14.0/24`, `corp.local`). Live
commands were adapted to isolated localhost services; the website was always the source of the
step and command text. Evidence: `audit/evidence/scenario-runs.json` and
`audit/evidence/scenario-run.log`.

### S01 — First contact and port discovery

- **Topology:** Kali `10.10.14.5` → target `10.10.10.10`; live stand-in `127.0.0.1`.
- **Start:** no prior knowledge. **Objective:** confirm reachability and get a port list.
- **Site path:** Nmap 01 → 02 → 03 → 06.
- **Expected:** route via `tun0`/loopback, live host, open ports.
- **Actual:** connectivity confirmed; sweep found the host; `nmap -sCV` eventually identified
  SSH, Samba, FTP and TLS but took **224 s** on five local ports because of TLS cipher
  enumeration. The shipped `sudo -sS` could not run (no passwordless sudo).
- **Negative branch:** closed port 1 → `closed tcpmux`, correctly interpreted. A literal
  `<TARGET_IP>` produced a bash syntax error, which the UI's missing-value banner prevents.
- **Result:** Pass for discovery; **Verified** for the commands that ran. The `-sCV` runtime is
  a real scheduling risk the site only partially warns about.

### S02 — Web application enumeration

- **Target:** `http://10.10.10.10` (live: `127.0.0.1:8124`), TLS stand-in `:8443`.
- **Site path:** HTTP 02 → 03 → 04 → 05, then Directory 03/04.
- **Expected:** banner, headers, path/status differential, assets, hidden paths.
- **Actual:** `whatweb` identified Python SimpleHTTP; `curl` returned headers/body; the status
  loop distinguished 200 from 404; `ffuf` and `gobuster` both found `index.html`, `data`,
  `assets/app.js`.
- **Negative branch:** port 9999 → `curl: (7) Failed to connect` (exit 7). The page does not
  provide a recovery branch for an unreachable web port; the Troubleshooting page does.
- **Failure observed:** `curl -I https://...` against a minimal TLS server hung until the test
  timeout. The site's own `http-03` mistake note warns that `-I`/HEAD behaves differently, but
  the command as written has no timeout. Medium guidance gap.
- **Result:** Pass. **Verified** for `whatweb`, `curl`, `ffuf`, `gobuster` against localhost.

### S03 — SMB enumeration and access checks

- **Target:** `10.10.10.10` (live: local Samba 4.24.5).
- **Site path:** SMB 01 → 02 → 03 → 05 → 06 → 07.
- **Actual:** version/signing identified; null session listed `APPS`, `print$`, `IPC$`;
  `smbmap` produced a permission map; `nxc` authenticated as null and reported `READ,WRITE`
  on `APPS`.
- **Negative branch:** `smbclient -N //127.0.0.1/NOPE` → `NT_STATUS_BAD_NETWORK_NAME`, which
  `smb-10` explicitly tells the user to expect.
- **Result:** Pass. **Verified** for all six commands that ran. `smb-enum-users` and
  `smb-os-discovery` returned no data on this Samba build — an empty script result is not
  proof of absence, and the page's mistake note covers exactly that.

### S04 — DNS enumeration

- **Target:** `corp.local` at `10.10.10.10`; live `dnsmasq` on `127.0.0.1:5353`.
- **Site path:** DNS 01 → 02 → 03 → 05.
- **Actual:** port 53 on localhost is closed, so `dns-01` correctly reported no DNS; the
  adapted `dig -p 5353` returned `10.10.10.10`; AXFR was refused (`Transfer failed`).
- **Negative branch:** `dig @127.0.0.1 corp.local` → `connection refused` (exit 9). The site's
  `dns-02` has no "resolver refused" branch; the reader must infer it.
- **Result:** Pass with a documented port adaptation. **Verified** for `dig`; `dnsenum`,
  `dnsrecon` and `/etc/hosts` changes were **not** run.

### S05 — FTP enumeration and mirroring

- **Target:** `10.10.10.10:21`; live `pyftpdlib` on `:2121`.
- **Site path:** FTP 01 → 02 → 07 → 09.
- **Actual:** version detected; `ftp-anon` returned **no output** even though anonymous login
  worked; `wget -m` mirrored the tree; triage found a credential in `sub/app.conf`.
- **Negative branch:** bad credentials → FTP 530 (curl exit 67), which matches `ftp-04`'s
  expected `530`.
- **Result:** Pass for mirroring/triage, **workflow gap**: the site offers no branch for "NSE
  script produced nothing" (AUD-12). A user could wrongly conclude anonymous access is off.

### S06 — SSH authentication troubleshooting

- **Target:** `10.10.10.10:22`; live `sshd` on localhost.
- **Site path:** SSH 01 → 02 → 10 → 03.
- **Actual:** `PreferredAuthentications=none` returned `Permission denied
  (publickey,password)`; the NSE script agreed; `ssh -v` showed the negotiation and auth
  stages.
- **Negative branch:** no credential → denied. The site routes this to Step 04 (verbose),
  which produced the expected evidence. `ssh-04`'s `sshpass` is not installed and the
  prerequisite is undocumented.
- **Result:** Pass for detection/troubleshooting; credential testing **not tested**.

### S07 — Linux privilege-escalation triage

- **Target:** local Linux host.
- **Site path:** Linux PrivEsc 01 → 04 → 07 → 09 → 11.
- **Actual:** identity and sudo version; SUID list; capability list; cron configuration;
  identity-file modes. `sudo -l` cannot prompt without a TTY — exactly the behaviour `lp-01`
  warns about.
- **Negative branch:** none executed (no privilege escalation attempted; out of scope).
- **Result:** Pass for triage. **Verified** for read-only enumeration. Exploitation steps
  (02, 05, 08, 10, 12, 14, 15, 18, 20, 21) were **not run**.

### S08 — Active Directory / Kerberos (simulated)

- **Topology:** fictional DC `10.10.10.10`, domain `corp.local`, user `alice`.
- **Site path:** AD 01 → 02 → 02a → 03 …
- **Actual:** no DC exists in this environment. Local SMB banner is a non-domain Samba host;
  `_ldap._tcp.corp.local` SRV returned nothing.
- **Result:** **Simulated / not tested.** All AD, Kerberos, delegation, ADCS and DCSync steps
  remain unexecuted. The workflow is logically ordered in the data, but no positive path was
  evidenced.

### S09 — Failed command and recovery (the parser corruption)

- **Start:** a user follows HTTP Step 06 to inspect a certificate.
- **Shipped command (pre-fix):**
  `openssl s_client -connect <TARGET_IP>:443 -servername <DOMAIN> /dev/null | openssl x509 ...`
- **Actual:** `s_client: cannot provide both -connect option and target parameter` and
  `Could not find certificate from <stdin>` (exit 1). The site offered **no** troubleshooting
  branch for this failure.
- **Corrected command:** `... </dev/null 2>/dev/null | openssl x509 ...` → `subject=CN=corp.local`
  (exit 0).
- **Result:** Fail → **fixed** and regression-tested. This was the clearest example of a
  command that "looks right" but never worked.

### S10 — Wrong path and missing tool

- **Site path:** Directory 01 → 03.
- **Actual:** wordlists exist; a missing wordlist path makes `ffuf` print usage and exit 1;
  a closed web port with `-s` produces **no output and exit 0**, which is an exam-time trap
  unless the reader notices the missing hits. The site's commands do not use `-s`, so the
  failure would normally be visible, but there is no explicit "zero hits does not always mean
  no paths" branch for connection errors.
- **Missing tools:** `hakrawler` and `katana` are both absent; `http-12` does not say so.
- **Result:** Partial. Prerequisite discovery passes; failure recovery is incomplete.

### S11 — Windows / mixed-context block (simulated)

- **Target:** fictional Windows host.
- **Actual:** `Get-Acl HKLM:SOFTWARE<VENDOR>` is invalid as shipped; corrected to
  `Get-Acl HKLM:\SOFTWARE\<VENDOR>`. `pwsh` is unavailable, so the corrected form is
  **syntax-reviewed, not executed**.
- **Mixed block:** pre-fix, one block combined `md5sum` and `certutil`/`Get-FileHash`, and
  another combined Linux and Windows proof commands. Split into one fence per context.
- **Result:** Fail → **fixed** (parser/data); Windows execution remains **not tested**.

### Scenario summary

| Scenario | Result | Evidence |
| --- | --- | --- |
| S01 discovery | Pass | live localhost nmap |
| S02 web | Pass | live curl/whatweb/ffuf/gobuster |
| S03 SMB | Pass | live Samba |
| S04 DNS | Pass with port adaptation | live dnsmasq |
| S05 FTP | Pass + workflow gap (AUD-12) | live pyftpdlib |
| S06 SSH | Pass for detection | live sshd |
| S07 Linux privesc | Pass for triage | local host |
| S08 AD/Kerberos | Simulated | no DC available |
| S09 failed command | Fail → fixed | OpenSSL repro |
| S10 wrong path/tool | Partial | ffuf/tool checks |
| S11 Windows block | Fail → fixed; unverified on Windows | static |

---

## E. Workflow coverage matrix

`Page exists` means a service view is available. `Command coverage` is steps/commands in that
view. `Branches tested` lists the positive/negative branches actually exercised (not merely
present in prose).

| Service | Page exists | Command coverage | Branches tested | Positive test | Negative test | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Nmap | Yes | 25 steps / 24 cmds | sweep, version scan, closed port, missing var | Yes | Yes | Pass | S01 |
| SMB | Yes | 21 / 18 | null listing, permission map, bad share | Yes | Yes | Pass | S03 |
| FTP | Yes | 12 / 11 | anonymous mirror, bad creds, silent NSE | Yes | Yes | Pass + gap | S05 |
| DNS | Yes | 9 / 9 | A record, AXFR refusal, refused resolver | Yes | Yes | Pass | S04 |
| HTTP/HTTPS | Yes | 33 / 30 | headers, path diff, TLS cert | Yes | Yes (closed port) | Pass | S02/S09 |
| SSH | Yes | 12 / 13 | auth methods, verbose trace | Yes | Yes (denied) | Pass | S06 |
| NFS | Yes | 2 / 2 | — | No | No | Not tested | static |
| SMTP | Yes | 2 / 2 | — | No | No | Not tested | static |
| SNMP | Yes | 2 / 2 | — | No | No | Not tested | static |
| MySQL | Yes | 1 / 2 | — | No | No | Syntax-checked | static |
| MSSQL | Yes | 2 / 3 | — | No | No | Syntax-checked | static |
| RDP | Yes | 1 / 1 | — | No | No | Not tested | static |
| WinRM | Yes | 3 / 3 | — | No | No | Not tested | static |
| IPMI | Yes | 1 / 1 | — | No | No | Not tested | static |
| Active Directory | Yes | 62 / 67 | simulated only | No | No | Simulated | S08 |
| Impacket | Yes | 6 / 6 | — | No | No | Not tested | static |
| NetExec | Yes | 10 / 10 | null auth + shares (via SMB) | Yes | Partial | Pass (subset) | S03 |
| BloodHound | Yes | 14 / 13 | — | No | No | Not tested | static |
| Kerberos | Yes | 6 / 6 | — | No | No | Not tested | static |
| Passwords & hashes | Yes | 12 / 12 | — | No | No | Not tested | static |
| Linux PrivEsc | Yes | 21 / 21 | identity, SUID, caps, cron, perms | Yes | No | Pass (triage) | S07 |
| Windows PrivEsc | Yes | 19 / 19 | — | No | No | Syntax-reviewed | S11 |
| PrivEsc (combined) | Yes | 40 / 40 | subset via Linux | Yes | No | Partial | S07 |
| Shells | Yes | 15 / 18 | — | No | No | Not tested | static |
| File Transfer | Yes (chip added) | 15 / 18 | — | No | No | Not tested | static |
| Tunneling/Pivoting | Yes | 11 / 11 | — | No | No | Not tested | static |
| Exploitation | Yes | 14 / 12 | — | No | No | Not tested | static |
| Content Discovery | Yes (chip added) | 17 / 17 | ffuf/gobuster | Yes | Yes | Pass | S02/S10 |
| Exam | Yes (chip added) | 12 / 9 | — | No | No | Not tested | static |
| Notes | Yes (chip added) | 2 / 2 | template render | Yes | No | Pass | browser |
| Node Inspector | Yes (chip added) | 1 / 2 | — | No | No | Not tested | static |
| Troubleshooting | Yes (chip added) | 9 / 7 | — | No | No | Not tested | static |

---

## F. Defect backlog

Status values: **Fixed** (with regression test), **Open**, **Informational**.
Evidence is in `audit/evidence/`.

### High

| ID | Severity | Location | What was wrong | Evidence | Fix / status |
| --- | --- | --- | --- | --- | --- |
| AUD-01 | High | `tools/parse.mjs` → `http-06`, `active-directory-18`, `linux-privesc-08`, `machine-notes` | Tag stripping ran on fenced code, deleting `</dev/null`, `<TARGET_COMPUTER$>`, `<python3>` and template text. Two commands were invalid; one was not a shell command. | `fence-diff` baseline: 10 fences missing/8 altered; S09 exits 1 and 127 | Protect fences before HTML processing; restore verbatim. **Fixed**; fence diff 355/355; regression test |
| AUD-02 | High | `windows-privesc-15` (source export) | `Get-Acl` targets lost backslashes: `HKLM:SOFTWARE<VENDOR>`, `HKLM:SYSTEMCurrentControlSetServices<SERVICE>` | Generated vs raw data; no PowerShell available | Corrected to `HKLM:\SOFTWARE\<VENDOR>` and `HKLM:\SYSTEM\CurrentControlSet\Services\<SERVICE>`. **Fixed**; syntax-reviewed only |
| AUD-03 | High | `ssh-03`, `ssh-12` | Referenced "Step 13"; the SSH page has 12 steps after reorder | `ref-audit.txt` | Point to the Troubleshooting page. **Fixed**; regression test |
| AUD-04 | High | `other-services-07/08/12`, `shells-12/14/15`, `exam-execution-05` | One copy block mixed Kali shell, MySQL/MSSQL prompt, Node REPL, Windows cmd and PowerShell. Pasting the block fails. | `bash -n` failures; S05/S11 | Split into one fence per context with accurate language label. **Fixed**; 0 real bash failures |

### Medium

| ID | Severity | Location | What was wrong | Evidence | Fix / status |
| --- | --- | --- | --- | --- | --- |
| AUD-05 | Medium | `nmap-15`, `smb-02`, `http-12`, `nmap-18` | Wrong or dangling next-step references (FTP Step 06 for anonymous, "Step 03 (null session)", `NEXT: Step 12` self-loop, non-existent "Database Services page") | `ref-audit.txt` | Corrected refs. **Fixed**; regression test |
| AUD-06 | Medium | `nmap-25`, `http-02/03/06/08/12/13`, `bleeding-edge-12` | Trailing blockquote/provenance text was absorbed into "Evidence" or "Success path"; the PrintNightmare **Risk** and **Cleanup** text was hidden inside success | `static-audit.txt` | Detach to step notes; text preserved. **Fixed**; regression test |
| AUD-07 | Medium | `post-exploitation-13…17`, `directory-vhost-08` | Step headings rendered raw Markdown links/backticks, including fake `http://psexec.py` links | Browser audit | Plain-text heading renderer. **Fixed**; browser test |
| AUD-08 | Medium | Service chip row | 6 of 32 service views unreachable from the UI (transfer, fuzzing, node, exam, notes, troubleshooting) | Browser audit `activeChip=false` | Render all tagged services after the preferred list. **Fixed**; browser test |
| AUD-09 | Medium | Step cards | Alternative branches looked identical to mandatory steps | Browser audit | `ALTERNATIVE` badge derived from the title. **Fixed**; browser test |
| AUD-10 | Medium | `hashchange` routing | Unknown in-app hash rendered Nmap while the URL stayed invalid | Browser audit | Validate route on hashchange, fall back to SMB. **Fixed**; browser test |
| AUD-11 | Medium | `machine-notes-01/02`; `runOn=unspecified` | Template headings lost their text (`01. \`), template fences were empty, "UNSPECIFIED" badge was meaningless | `static-audit.txt`, browser | Preserve escaped placeholders and fences; show "Context varies". **Fixed** |
| AUD-12 | Medium | `ftp-02` | `ftp-anon` legitimately returns nothing on some servers; the page has no "no output → verify manually" branch, so a working anonymous service can look closed | S05 live run | **Open.** Add a failure branch: retry with `ftp`/`curl`/`wget` and only then conclude anonymous is off |
| AUD-13 | Medium | `bloodhound-09` | "GenericAll on a user" has a decision ("reset succeeds") but no command and no pointer to `bloodhound-08`, which contains the reset | Data inspection | **Open.** Add the command or say "use Step 08" |
| AUD-14 | Medium | Multiple | Tool-name and prerequisite drift: `sshpass`, `hakrawler`, `katana`, `testssl.sh`, `certipy` vs `certipy-ad`, `ipmitool`, `bloodyAD`; legacy Impacket `.py` names; `crackmapexec` vs `nxc` | `tool-inventory.txt`, tool checks | **Open.** State the modern package/wrapper and add a "missing tool" recovery line per step |

### Low

| ID | Severity | Location | What was wrong | Fix / status |
| --- | --- | --- | --- | --- |
| AUD-15 | Low | `README.md` | Said `ATTACK_IP` (actual `ATTACKER_IP`), 309 commands (now 318), 57 variables (59), 46 tests (57), 21 guidance steps (19) | **Fixed** |
| AUD-16 | Low | `linux-privesc-15` title | `no\_root\_squash` leaked export escaping | **Fixed** |
| AUD-17 | Low | `machine-notes` | Horizontal rule `---` becomes a note on step 02; `<filename>` in a `<code>` cell is empty | **Open** (cosmetic) |
| AUD-18 | Low | `other-services-12` / `shells-15` | Windows/PowerShell commands still sit beside `cmd` labels in some steps; `Get-FileHash` is PowerShell but labelled `cmd` | **Open** (label refinement) |
| AUD-19 | Low | `windows-privesc-05` | Source prose had lost path backslashes (`C:Program Files...`); commands were intact | **Fixed** |
| AUD-20 | Informational | `nmap-06` vs `nmap-21` | Identical scan command repeated for the "save every format" step; intentional but redundant | No change |

### Workflow design observations (Informational)

- The data model has no explicit `branch`/`alternative` type. Branching is encoded in titles
  (`Alternative:`) and priority. The new badge reduces the risk, but a real `branch` field
  would be more robust.
- `runOn` values are free text (`kali`, `target`, `either`, `windows`, `pivot`, `other`,
  `unspecified`) and render as uppercase badges. "EITHER" is less clear than naming both hosts.
- The site renders commands but has no "what to do when the expected output is absent" field
  distinct from `failure`. Many steps use `failure` well (SSH, Bleeding Edge); others do not.
- There is no command-level "verified on" date or tool version. Given deliberate tool drift,
  adding a version stamp to `Syntax Checked` steps would make the label auditable.

---

## G. Regression test plan

Implemented in `tests/audit-regression.test.mjs` (6 tests) and `tests/browser.test.mjs`
(5 new tests, 19 total). Each test is deterministic and runs with `npm test`.

| Defect | Test |
| --- | --- |
| AUD-01 | `every source code fence survives into the dataset byte-for-byte` — extracts all fences per raw page and asserts the generated command/output/page-code multiset is identical |
| AUD-01 | `shell redirections and angle-bracket placeholders are preserved verbatim` — asserts `</dev/null 2>/dev/null`, `<python3>`, `<TARGET_COMPUTER$>`, and both `Get-Acl` paths |
| AUD-01/AUD-11 | `machine notes keep their template commands instead of empty blocks` |
| AUD-06 | `page-level blockquotes and provenance notes stay out of step fields` + asserts Risk/Cleanup moved to notes |
| AUD-03/AUD-05 | `cross-references point at steps and pages that exist` — no out-of-range Step N, plus the four corrected refs |
| AUD-08 | Data test confirms all six previously hidden service tags exist; browser test asserts the chip labels and an active chip on `/s/transfer` |
| AUD-07/AUD-09 | Browser test: no rendered heading contains `](` or backticks; `bleeding-edge-15` has the Alternative badge and `-16` does not |
| AUD-10 | Browser test: navigating from `#/p/nmap` to `#/p/does-not-exist` renders SMB |
| AUD-11 | Browser test: `active-directory-14` shows "Context varies" |

Additional checks performed but not committed as tests (they require a live local lab):
fence-diff harness (`audit/scripts/fence-diff.mjs`), `bash -n` harness
(`audit/scripts/syntax-check.mjs`), browser route/chip/overflow audit
(`audit/scripts/browser-audit.mjs`), and the scenario runner (`audit/scripts/scenarios.mjs`).

---

## H. Recommended roadmap

### 1. Must fix before relying on the site

1. **AUD-12** — add the "NSE returned nothing → verify manually" branch to FTP, and an
   equivalent branch to any other script-first step (SMB `smb-enum-users` already has a note).
2. **AUD-13** — give `bloodhound-09` its command (or an explicit pointer to Step 08). A step
   that describes success without an action is a dead end under time pressure.
3. **AUD-14 (high-value subset)** — add prerequisite/tool-name lines for `sshpass`,
   `hakrawler`/`katana`, `testssl.sh`, and standardise on `impacket-*` wrappers; replace
   `crackmapexec` with `nxc` in `bleeding-edge-19`.
4. Run the corrected `windows-privesc-15` command on a disposable Windows VM and change its
   status if the output matches; the current fix is syntax-reviewed only.

### 2. Fix before sharing with other learners

5. Add a real `branch` field (`primary` / `alternative` / `conditional` / `troubleshooting`)
   and render branch steps differently. The title-derived badge is a stopgap.
6. Normalise `runOn` to `attacker` / `target` / `either` / `pivot` and render a sentence
   ("Run on the attacker host") rather than an uppercase token.
7. Add a "missing expected output" line to every step that currently lacks a `failure` field,
   especially HTTP, DNS and content discovery.
8. Clean `machine-notes` cosmetics (horizontal rule note, `<filename>` cell).
9. Add a tool-version / last-verified date to the status badge tooltip.

### 3. Useful later

10. Add a "current step / next step" pin or progress marker for multi-step workflows.
11. Add a saved-findings panel (host, port, credential) that feeds the variable drawer.
12. Add a command-history export for the exam report.
13. Add CI that runs `npm run build && npm run validate && npm test` and fails if generated
    data drifts from the raw export.

---

## I. Evidence and limitations

### Environment

| Item | Value |
| --- | --- |
| OS | Linux (Kali), Node 24.21.0, Python 3.14.6 |
| Browser | Chromium 150.0.7871.181 |
| Nmap | 7.99 |
| Samba/smbclient | 4.24.5-Debian |
| NetExec | 1.5.1 |
| Impacket | installed as `impacket-*` wrappers; legacy `.py` scripts absent |
| OpenSSL | 3.6.3 |
| ffuf | 2.1.0-dev |
| WhatWeb | 0.6.4 |
| Nikto | 2.6.0 |
| hashcat | 7.1.2 |
| john | 1.9.0-jumbo-1 |

### Local lab services (all bound to loopback)

- `python3 -m http.server 8124` serving the site under test.
- Samba on 445/139 (pre-existing system service).
- `sshd` on 22 (pre-existing system service).
- `pyftpdlib` on 127.0.0.1:2121 with an anonymous root containing a test credential file.
- `dnsmasq` on 127.0.0.1:5353 serving `corp.local` and `files.corp.local`.
- `openssl s_server` on :8443 with a self-signed `CN=corp.local` certificate.

No scans or exploits were sent outside 127.0.0.1 / the local host. No sudo, no `/etc/hosts`
edits, no service exploits, no credential attacks against real systems. The scenario IPs
(10.10.x.x) are fictional and were not contacted.

### Commands used for testing

See `audit/evidence/scenario-runs.json` (53 runs with exact commands, exit codes, durations and
trimmed output), `audit/evidence/syntax-check.json` (277 bash-family syntax checks),
`audit/evidence/tool-inventory.txt`, `audit/evidence/ref-audit.txt`,
`audit/evidence/static-audit.txt`, and `audit/evidence/browser-audit-postfix.txt`.

### What remains unverified

- **All Windows, Active Directory, Kerberos, delegation, ADCS, DCSync, relay, Metasploit and
  payload steps.** No Windows/DC host and no authorization to run them.
- **All destructive or privilege-changing commands** (`passwd` writes, SUID creation, service
  reconfiguration, kernel exploits, credential dumping) were deliberately not executed.
- **Tool-version behaviour** for absent tools (`sshpass`, `lftp`, `hakrawler`, `katana`,
  `testssl.sh`, `ipmitool`, `bloodyAD`).
- **The Vercel/HTTPS deployment path** and cross-browser behaviour (Chromium only).
- **The service worker under storage eviction** — only the happy-path offline reload was tested.
- Fence-fidelity and `bash -n` checks prove text/structure, not that a command achieves its
  stated security outcome.

### Audit artifacts

```
audit/
├─ OSCP-EXAM-READINESS-AUDIT-2026-10-29.md   (this report)
├─ scripts/static-audit.mjs, fence-diff.mjs, ref-audit.mjs,
│          tool-inventory.mjs, syntax-check.mjs,
│          browser-audit.mjs, scenarios.mjs
└─ evidence/
   ├─ commands.txt                  full pre-fix command inventory
   ├─ static-audit.txt              pre-fix structural anomalies
   ├─ ref-audit.txt                 step/page/section references
   ├─ tool-inventory.txt            installed vs referenced tools
   ├─ syntax-check.json             bash -n results (post-fix)
   ├─ scenario-runs.json / .log     53 local runs with exit codes/output
   ├─ browser-audit-postfix.txt     routes, nav, variables, copy, overflow, console
   └─ post-fix-verification.txt     corrected commands and OpenSSL proof
```

The baseline copy of `data/`, `tools/`, `tests/`, `content/`, `assets/` and `index.html` from
before any edit is in `/tmp/oscp-baseline/` (ephemeral). Existing user backups under
`backups/` were not touched.

---

## J. Final readiness verdict

**Limited Lab Trial.**

Why not higher:

- **No command is `Lab Tested`.** The site's own labels say this. The audit executed a
  read-only subset against localhost; Windows/AD/exploitation paths were simulated or
  syntax-reviewed. Those are the paths where an exam candidate needs the most confidence.
- **Five defects remain open** (AUD-12/13/14/17/18), including two Medium workflow gaps
  (AUD-12 FTP silent-script recovery, AUD-13 BloodHound dead end) and the
  environment-dependent tool naming (AUD-14).
- The site still cannot tell a user "this output is missing, do this next" for several
  services; the decision fields are good on SSH and Bleeding Edge but uneven elsewhere.

Why not lower:

- All Critical/High defects found in the audit were reproduced, fixed, rebuilt, and covered
  by regression tests. The fixed build passes 57/57 tests and validation, renders all 24 pages
  and 32 service views with zero console/network errors, and preserves every source fence
  byte-for-byte.
- Variables, copy, missing-value banners, routing, filters, search, offline reload and mobile
  navigation work as documented.
- The site is honest about evidence: no status inflation, no fabricated outputs, no
  third-party calls, and every command's execution host and prerequisites are visible (even
  where incomplete).

**Bottom line for an exam candidate:** use it in a lab trial, with the Nmap/SMB/HTTP/SSH/
Linux-triage pages as the most trustworthy sections. Treat every AD, Windows, relay, payload
and credential-dumping command as a lead to verify in your own lab, not as a tested recipe.
Do not rely on the FTP script result alone, and check that the tool the page names is actually
installed under that name.
