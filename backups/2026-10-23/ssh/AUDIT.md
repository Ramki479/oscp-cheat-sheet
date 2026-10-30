# SSH ordering audit — 2026-10-23

Source page: `SSH — Complete Command Reference`
Notion page: `4011e512-38b5-8123-b446-cc627bc02913`
Parent: `📖 OSCP Command Handbook`

## Backup

- `ssh.html` — original local source export, verified against Notion before editing.
- `ssh.json` — original page metadata.
- `ssh-page.json` — original page extracted from the generated dataset.
- `commands.json` — full generated dataset before the audit.
- `SHA256SUMS.txt` — hashes of the backup files.
- `MANIFEST.json` — original section/step order and counts.

Original: **15 sections · 11 steps · 11 command blocks**.

## Final SSH sequence

| Display | Stable ID | Step |
| --- | --- | --- |
| 01 | `ssh-01` | Confirm the service and version |
| 02 | `ssh-02` | Ask without authenticating |
| 03 | `ssh-10` | Read the algorithm list |
| 04 | `ssh-03` | Verbose connection trace |
| 05 | `ssh-04` | One deliberate attempt, not a brute force |
| 06 | `ssh-05` | Identify a found key |
| 07 | `ssh-06` | Check matching public keys |
| 08 | `ssh-07` | Fix permissions before SSH refuses the key |
| 09 | `ssh-08` | Detect the passphrase |
| 10 | `ssh-09` | Crack the passphrase |
| 11 | `ssh-12` | Connect using the private key |
| 12 | `ssh-11` | Connect with legacy algorithms when required |

Final: **19 sections · 12 steps · 13 command blocks**.

## Changes made

1. Moved algorithm enumeration (`ssh-10`) ahead of credential use.
2. Moved verbose diagnostics (`ssh-03`) ahead of credential use.
3. Moved key discovery/validation, permissions and passphrase handling ahead of the key connection.
4. Split detection from authentication/algorithm scripts in `ssh-01`:
   - Before: `nmap -sCV -p22 --script ssh-auth-methods,ssh2-enum-algos <TARGET_IP>`
   - After: `nmap -sV -p22 <TARGET_IP>`
   - Reason: keep detection fast; authentication behavior is `ssh-02`, algorithm enumeration is `ssh-10`. The original `ssh-auth-methods` NSE check is retained as a second command in `ssh-02`.
5. Added the missing key-connect command as `ssh-12`:
   - `ssh -i <KEY_FILE> <USERNAME>@<TARGET_IP>`
6. Kept the legacy-algorithm command as `ssh-11` and moved it into a compatibility section after the normal key connection.
7. Added purpose, prerequisites, observed result, success path, failure path, decision, next step, common mistake and evidence fields to all 12 SSH steps.
8. Replaced the unrendered Markdown troubleshooting table with a readable list.
9. Preserved internal Notion references to Tunneling & Pivoting and Linux Privilege Escalation as native page mentions; the frozen export represents the same targets as local `#/p/<slug>` links so they work offline.
10. Added `content/step-ids.json` so reordering/renumbering keeps the original command IDs.
11. All original command topics remain: ten command blocks are byte-for-byte unchanged, the combined `ssh-01` block was split, and the `ssh-auth-methods` half is retained in `ssh-02`.

## ID preservation

- `ssh-01` … `ssh-11` all remain in the dataset.
- New key-connect step uses `ssh-12`.
- `ssh-10` now displays as step 03; `ssh-11` displays as step 12.
- No duplicate IDs; the generated dataset validates.

## Verification

- `npm run build` → 23 pages, 298 steps, 278 commands, 57 variables, 11 warnings.
- `npm run validate` → OK.
- `npm test` → 42 tests passed, 0 failed.
- Only `ssh` differs from the backed-up generated dataset; every other page is byte-identical.
- Notion page re-fetched: 19 sections and 12 steps in the intended order; 12 code blocks.
- Tunneling and Linux PrivEsc mention targets were fetched successfully.
- Browser test: ordered SSH cards, all nine decision fields, Quick Navigation, TARGET_IP substitution, unresolved KEY_FILE banner, and the Tunneling route.

## Verification status

No SSH session was opened against a live target. No step is `Lab Tested`.
`ssh -i`, key inspection/fingerprint, permissions and passphrase commands were checked
against the local OpenSSH tools. `sshpass` is not installed locally; the credential step is
`Documented — Untested`. The legacy compatibility step remains `Documented — Untested`.
