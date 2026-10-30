# Active Directory & Windows — Isolated Lab Validation Plan

**Date:** 2026-10-30
**Status:** plan only — **nothing in this document has been executed**
**Applies to:** the steps currently labelled `Documented` or `Environment Dependent` on the
Active Directory, BloodHound, Post-Exploitation, Bleeding Edge, Windows Privilege Escalation,
Passwords, Kerberos and Windows parts of Shells/File Transfer pages.

> Every workflow below is **unverified**. This plan exists so that the next validation pass
> produces evidence instead of impressions. No result may be recorded as `Lab Tested` until
> the positive path has actually been demonstrated in a lab of this shape.

---

## 1. Rules for this validation pass

1. **Authorised environment only.** A lab you own or are contracted to test. Host-only or
   internal-only networking. No internet-routable target, no third-party domain, no borrowed
   account.
2. **Snapshot before every workflow.** Roll back after it, so each workflow starts from the
   same state and a failure cannot be blamed on an earlier one.
3. **Record the environment, not just the command.** Windows build, domain functional level,
   tool version, user, privilege level, timezone/clock skew.
4. **Both branches or it does not count.** The success path *and* at least one failure or
   recovery branch (bad credential, missing tool, patched target, wrong right).
5. **Status changes are a separate commit.** A step becomes `Lab Tested` only when
   `data/lab-results.json` contains a passing run for it, referenced from the report.
6. **No destructive test on a machine you need.** Kernel exploits, relay against production
   CAs, and DCSync against a domain you care about are out of scope even in a lab unless the
   lab is disposable.
7. **Sanitise before publishing.** Replace domain names, hashes, passwords and flags with
   `<DOMAIN>`, `<NTHASH>` etc. Keep the unredacted copy out of the repository.

Out of scope for this pass: internet-facing targets, phishing, physical access, cloud AD
(Entra ID), any technique that needs a real certificate authority you do not control.

---

## 2. Lab topology

| Host | Role | OS | Notes |
| --- | --- | --- | --- |
| `kali` | attacker | Kali 2026.x, 2 vCPU / 4 GB | tools from the version table below |
| `dc01` | domain controller | Windows Server 2019 or 2022 | `corp.local`, DNS, one CA role (ADCS workflow only) |
| `fs01` | member server | Windows Server 2019 | file share, one vulnerable service, one local admin |
| `ws01` | workstation | Windows 10/11 | a logged-in domain user session for BloodHound session data |

Network: `10.10.10.0/24` host-only (attacker `10.10.14.5/24` where a second segment is
needed). No NAT to the internet. Snapshots: `clean`, `pre-adcs`, `pre-relay`.

Domain setup that makes the workflows meaningful:

- `MachineAccountQuota = 10` (RBCD / noPac paths), one user with `GenericAll` over another,
  one `WriteDACL` on the domain object, one `ForceChangePassword` edge, one Kerberoastable
  service account, one AS-REP-roastable user, one `unconstrainedDelegation` host.
- One ADCS template vulnerable to ESC1, one to ESC4, and Web Enrollment enabled for ESC8
  (only in the `pre-relay` snapshot).
- One service with an unquoted path and one writable service binary for Windows privesc.
- One local administrator account reusing a password across `fs01` and `ws01`.

---

## 3. Tool baseline to record

Capture `--version` output for: `nxc`, `impacket-*` (package version), `bloodhound-python`,
`bloodhound` + `neo4j`, `certipy`, `bloodyAD`, `kerbrute`, `ldapsearch`, `rpcclient`,
`smbclient`, `smbmap`, `hashcat`, `john`, `evil-winrm`, `xfreerdp`, `chisel`, `socat`,
`proxychains4`, `msfvenom`. On the Windows side: `systeminfo`, PowerShell `$PSVersionTable`,
and the build numbers of SharpHound, Rubeus, mimikatz, PrintSpoofer/GodPotato, winPEAS and
PrivescCheck.

The tool reference page (`#/p/tool-reference`) lists the package each executable comes from;
use it as the checklist so a "command not found" is diagnosed in seconds.

---

## 4. Evidence format

One JSON file, `audit/evidence/lab-results.json`, appended by the runner:

```json
{
  "workflow": "W2-kerberos",
  "stepIds": ["active-directory-08", "active-directory-09", "active-directory-10"],
  "result": "pass | fail | blocked",
  "startedAt": "2026-11-XXTHH:MM:SSZ",
  "host": { "os": "Windows Server 2022 21H2 build 20348", "role": "DC", "domain": "corp.local" },
  "tool": { "name": "impacket-GetUserSPNs", "version": "0.12.0" },
  "command": "impacket-GetUserSPNs corp.local/alice:... -dc-ip 10.10.10.10 -request",
  "exitCode": 0,
  "expected": "one $krb5tgs$ hash for svc_sql",
  "observed": "one $krb5tgs$ hash; cracked with hashcat -m 13100 in 42 s",
  "negative": { "command": "...", "exitCode": 1, "observed": "no entries found" },
  "recovery": "used -request-user <TARGET_USER> after the broad query returned nothing",
  "sanitised": true,
  "evidenceFiles": ["loot/dc01/kerberoast.txt", "screens/dc01_ad09.png"]
}
```

A workflow is complete only when every listed step has a `pass` entry **and** the negative
branch is recorded.

---

## 5. Workflows

### W1 — AD enumeration (no credentials)

- **Site steps:** `active-directory-01`, `-02`, `-02a`, `-03`; `dns-02`, `dns-05`.
- **Machines:** `kali` → `dc01`, no credentials.
- **Tools:** `nmap` (7.99+), `dig`, `nxc`, `enum4linux-ng`, `rpcclient`, `ldapsearch`.
- **Positive test:** `nmap -sCV -p53,88,135,139,389,445,464,593,636,3268,3269,5985 <DC>` shows
  the DC role; `nxc smb <DC>` reports the domain and signing; the unauthenticated sweep
  returns the domain name, DC hostname and (with `--users`) a user list if the policy allows.
- **Expected evidence:** service banner set, domain name, DC hostname/FQDN, `namingContexts`
  from an anonymous LDAP root DSE query.
- **Negative test:** run the sweep with a wrong domain (`corp.loc`) → expect
  `STATUS_NO_LOGON_SERVERS` / no domain, and confirm the page's decision branch sends the
  reader to fix DNS rather than to conclude AD is absent.
- **Recovery:** LDAP 389 filtered → use `-p 636`/`3268`; SMB signing required → note it and
  continue read-only.
- **Cleanup:** none (read-only).

### W2 — Kerberos enumeration and authentication

- **Site steps:** `active-directory-07`, `-08`, `-09`, `-10`, `-11`, `-12`;
  `bloodhound-07` (query only).
- **Machines:** `kali` with one valid credential; `dc01`.
- **Tools:** `impacket-GetNPUsers`, `impacket-GetUserSPNs`, `kerbrute`, `hashcat`, `john`.
- **Positive test:** AS-REP roast the pre-auth-disabled user (`$krb5asrep$`), Kerberoast
  `svc_sql` (`$krb5tgs$`), crack both offline, then authenticate with the recovered password
  via `impacket-getTGT` and confirm a TGT in `KRB5CCNAME`.
- **Expected evidence:** both hash types with the source username, crack time and wordlist,
  a ccache file, `klist` output inside the same shell.
- **Negative test:** request a ticket for a user without an SPN → expect `No entries found`;
  confirm the step's Failure path tells the reader to check the SPN and not the credential.
- **Recovery:** clock skew → `ntpdate`/`timedatectl`; RC4 disabled on the DC → `-request`
  with AES and note `hashcat -m 19700` instead of `13100`.
- **Cleanup:** delete ccache files; revert the lab snapshot if the password was changed.

### W3 — BloodHound collection and analysis

- **Site steps:** `bloodhound-01`, `-02`, `-03`, `-04`, `-05`, `-06`, `-07`; `active-directory-04`, `-05`.
- **Machines:** `kali` (collector + UI), `dc01`, `ws01` (for a real session edge).
- **Tools:** `bloodhound-python`, `nxc --bloodhound`, SharpHound, BloodHound CE + Neo4j.
- **Positive test:** collect with all three collectors, import each zip, run the shortest-path
  query from an owned user to Domain Admins, and confirm the path matches the ACLs that were
  seeded (`GenericAll`, `ForceChangePassword`, `AddMember`).
- **Expected evidence:** collection timestamps, zip sizes, node/edge counts after import, the
  rendered path, the query text.
- **Negative test:** import a collection from a different domain → expect an empty/duplicate
  graph; confirm Step 04's guidance about matching the domain.
- **Recovery:** Neo4j not running → `neo4j status`; CE credentials differ from 4.x → log in
  with the CE defaults, note the version.
- **Cleanup:** stop Neo4j, delete the imported databases, remove the zips from the target.

### W4 — Windows privilege escalation

- **Site steps:** `windows-privesc-01`, `-02`, `-03`, `-04`, `-05`, `-06`, `-07`, `-08`,
  `-09`, `-10`, `-11`, `-12`, `-13`, `-14`, `-15`, `-16`, `-17`, `-18`, `-19`.
- **Machines:** `ws01`/`fs01` as a low-privilege domain user with an interactive shell.
- **Tools:** `winPEASx64.exe`, `Invoke-PrivescCheck`, `accesschk.exe`, `PrintSpoofer`/
  `GodPotato`, `Certify`/`certutil`, `reg`, `sc`, `icacls`.
- **Positive test:** each vector once, in this order — unquoted service path, writable service
  binary, `AlwaysInstallElevated`, stored credential, `SeImpersonatePrivilege` via
  GodPotato, registry key permission (`Get-Acl` on `HKLM:\SYSTEM\...\Services\<SERVICE>`).
  Each must end with `whoami /priv` or `whoami` showing the new context.
- **Expected evidence:** the vector, the exact command, the before/after privilege, the
  service/registry state, and the screenshot with the host IP visible.
- **Negative test (required):** run `Get-Acl HKLM:\SYSTEM\CurrentControlSet\Services\<SERVICE> | Format-List`
  on a key the user cannot write → confirm the ACE list shows only read access, and that the
  page's decision branch says "not writable, move on" instead of implying failure.
- **Recovery:** AV removes the payload → re-download with a renamed binary; PowerShell
  constrained language → use `cmd.exe` paths from the same step.
- **Cleanup:** delete uploaded binaries, restore the service binary path, remove scheduled
  tasks, revert the snapshot.

### W5 — ADCS / Certipy

- **Site steps:** `active-directory-19`, `-20`, `-21`; `bleeding-edge-13`, `-14` (relay to CA).
- **Machines:** `dc01` with the CA role (ESC1 + ESC4 + Web Enrollment), `kali` with one
  credential.
- **Tools:** `certipy` (from `certipy-ad`), `impacket-ntlmrelayx`, `PetitPotam.py`, `Rubeus`.
- **Positive test:** `certipy find -vulnerable` reports ESC1; `certipy req` issues a
  certificate for `administrator@corp.local`; `certipy auth` returns the NT hash; that hash
  authenticates with `nxc smb -H`.
- **Expected evidence:** the template name and ESC number, the issued `.pfx`, the NT hash
  (redacted), and the successful authentication.
- **Negative test:** request against a template the user cannot enrol in → expect
  `CERTSRV_E_TEMPLATE_DENIED` (`0x80094012`); confirm the step's Failure path sends the
  reader to ESC4/ESC8 rather than to "certipy is broken".
- **Recovery:** v4 vs v5 flag differences → `certipy -h`, adjust `-ca`/`-template` names;
  `-upn` rejected → confirm the template allows SAN.
- **Cleanup:** revoke the issued certificate, delete the `.pfx`, revert the snapshot.

### W6 — SMB authentication and credential validation

- **Site steps:** `smb-05`, `-06`, `-07`, `-08`, `-09`, `-10`, `-11`; `active-directory-22`;
  `bloodhound-08`.
- **Machines:** `kali`, `dc01`, `fs01`.
- **Tools:** `smbclient`, `smbmap`, `nxc`, `impacket-wmiexec`/`psexec`.
- **Positive test:** null session lists shares; a valid credential maps `READ,WRITE`;
  pass-the-hash with the recovered NT hash returns `(Pwn3d!)` on `fs01` and not on `dc01`
  unless the account is a DA.
- **Expected evidence:** share permissions before/after authentication, the `(Pwn3d!)` line,
  the exact hash used (redacted).
- **Negative test:** wrong password → `STATUS_LOGON_FAILURE`; wrong domain → `-d` mismatch
  note. Confirm the page distinguishes "bad credential" from "no access".
- **Recovery:** `SMB signing required` → note the limitation and switch to LDAP/WinRM paths.
- **Cleanup:** disconnect mapped shares, remove uploaded files.

### W7 — Relay workflows (highest risk, disposable snapshot only)

- **Site steps:** `bleeding-edge-13`, `-14`, `-15`, `-16`; `active-directory-16`, `-17`, `-18`.
- **Machines:** `kali` (relay + coercion), `dc01` with the CA and Web Enrollment, spooler
  enabled only in the `pre-relay` snapshot.
- **Tools:** `impacket-ntlmrelayx`, `PetitPotam.py`, `impacket-rbcd`, `impacket-addcomputer`.
- **Positive test:** start the relay with `--adcs --template DomainController`, coerce the DC
  with PetitPotam, confirm `GOT CERTIFICATE!` and use the resulting certificate to obtain a
  TGT for the DC machine account.
- **Expected evidence:** relay log lines, the certificate request ID, the base64 certificate,
  `Rubeus asktgt` output showing the TGT.
- **Negative test:** run the coercion with SMB signing enforced on the DC → the relay must
  fail with a clear error; record it, because that is the exam-realistic outcome.
- **Recovery:** spooler patched → the page's alternative branch (EFSRPC / other coercion)
  must be attempted and its result recorded.
- **Cleanup:** stop the relay, revert the snapshot, revoke the certificate, re-enable
  whatever policy was changed. **Never run this against a CA you do not own.**

### W8 — Post-access enumeration

- **Site steps:** `post-exploitation-01` … `-11`; `linux-privesc-01`/`-04`/`-07` for the
  Linux comparison; `smb-12`…`-18`.
- **Machines:** `fs01` and `ws01` with local admin, `kali` as the collection point.
- **Tools:** `nxc`, `impacket-secretsdump` (local `-sam`/`-lsa` only in this pass),
  `reg save`, `cmdkey /list`, `klist`.
- **Positive test:** local admin on `fs01` → `nxc smb --sam`/`--lsa` (local, not DCSync),
  registry hive save, credential-manager listing, and a session/host inventory.
- **Expected evidence:** local hash dump counts (values redacted), stored-credential entries,
  the host inventory, and a note on which findings are reusable elsewhere.
- **Negative test:** run the same collection as a non-admin → expect `Access is denied`;
  confirm the step says which privilege is missing.
- **Recovery:** Defender quarantines the tool → use the LOLBin path in the same step.
- **Cleanup:** delete dumps and uploaded tools, restore the hives, revert the snapshot.

---

## 6. Minimum passing set

The pass is complete when **all** of the following are recorded:

1. W1, W2 and W6 pass with a negative branch each (they are the highest-frequency exam paths).
2. W3 passes end-to-end: collect → import → query → exploit an edge (`bloodhound-08` → `-09`).
3. W4 passes for at least four vectors, including the `Get-Acl` registry check, because that
   command was corrected from an invalid form in the 2026-10-29 audit and has never run.
4. W5 passes for ESC1 at minimum, with `certipy-ad` installed from the documented package.
5. W7 runs in a disposable snapshot **or** is explicitly recorded as "not run — risk", with
   the reason.
6. W8 passes for local collection only; domain-wide DCSync stays out of scope unless the
   domain is disposable.

Once those exist, the affected steps can move to `Lab Tested` in `data/meta.json` and the
site's readiness verdict can move above **Limited Lab Trial**.

---

## 7. What this plan deliberately does not do

- It does not claim any workflow has been executed.
- It does not license credential dumping, relay or exploitation against any system that is
  not yours.
- It does not replace the site's status labels with a general "verified" claim: a lab run on
  Windows Server 2022 says nothing about a 2016 host or a hardened CA.
