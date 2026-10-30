# OSCP Cheat Sheet

A static, offline-ready command reference built from the **OSCP Command Handbook** source
export. Pick a service, fill the target values once, and copy commands that are already
rendered for your host. No Notion links are kept in the generated site.

- **No backend, no database, no auth, no runtime CDN.**
- **24 handbook pages + 1 generated tool reference · 321 steps · 321 command blocks · 59 variables.**
- Every command keeps an honest status label from a five-level vocabulary. **Nothing is marked `Lab Tested`.**
- Values live in memory by default. Passwords and hashes are never written to storage.

---

## Quick start

```bash
cd ~/oscp-cheat-sheet
npm run serve            # python3 -m http.server 8000
# open http://localhost:8000
```

Live data edits:

```bash
npm run build            # re-parse content/raw -> data/*.json
npm run validate         # data contract checks
npm test                 # 13 engine + 19 data + 14 regression + 19 browser acceptance tests
```

`npm test` needs Node 20+, Python 3 (for a throwaway static server on port 8123) and
Chromium at `/usr/bin/chromium`. Browser tests are skipped automatically when Chromium
is absent.

### `file://` does not work

The app uses `fetch()` for JSON and ES modules, both blocked from `file://` in current
browsers. Serve the folder over HTTP. The service worker also requires
`https://` or `localhost`.

---

## What it does

- **Pinned inputs** — `TARGET_IP`, `ATTACKER_IP`, `DOMAIN` are always in the header.
- **`+ Inputs` drawer** — every variable the current page uses, plus all 59 on demand.
  Sensitive fields are masked. Custom variables can be added with `A-Z`, `0-9`, `_`.
- **Service views** — SMB, HTTP, AD, Kerberos, NetExec, Impacket, NFS, and more. A step
  belongs to one primary service; a few pages add secondary tags (`privesc`, `fuzzing`,
  `transfer`).
- **Reference pages** — the 24 source pages, grouped, with section chips and prose/table
  layouts for workflow and exam pages.
- **Tool reference** — a generated page (`#/p/tool-reference`) listing every external tool the
  commands use: executable name, legacy name, package and install line, OS, required
  privileges, version caveats, and the pages that rely on it. Usage is derived from the
  commands themselves, so the table cannot drift from the cheat sheet.
- **Responsive shell** — a single-row sticky header on desktop (brand, pinned inputs,
  actions) and a compact three-row header on mobile, a sticky 260px navigation column, and
  a centered 1200px content column. A static service strip spans the width of the command
  panel under the header and scrolls away with the page.
- **Quick navigation** — numbered section chips directly under each page title, generated
  from the section data (e.g. `1. Scope and target`, `5. UDP scanning`). Clicking a chip
  smooth-scrolls to the section below the sticky header, then briefly flashes the heading.
  Prose pages expose every section; command pages expose command sections; service views
  include the source page when labels repeat.
- **Input validation** — malformed IPv4 values (for example `10.10.10.10.10`) and invalid
  domains are rejected inline. The bad value stays visible for correction but is not
  substituted into commands, so an unresolved `<TARGET_IP>` remains obvious.
- **Search** — global, multi-word, case-insensitive across titles, commands, decisions and
  notes. Results jump to the step.
- **Filters** — priority and status, with a live `x of y steps` count.
- **Copy** — copies the rendered command, never the `<TOKEN>` template. If a value is
  missing, the command is still copied and the toast names the unresolved tokens.
- **Missing value banners** — unresolved placeholders stay visible under the command and
  are listed by name, so a command is never silently wrong.
- **Offline** — PWA manifest + service worker. App shell is cache-first; JSON uses
  stale-while-revalidate. The header badge reports network/offline readiness.
- **No third-party requests** — fonts, icons and code are all local.

### Secrets policy

| Storage | Default |
| --- | --- |
| In-memory (`state.values`) | yes, current tab only |
| `localStorage` | off; opt-in for **non-sensitive** values only |
| URL / hash | never |
| Logs / analytics | no analytics; no value logging |
| Service worker cache | only static shell + generated JSON, never user input |

`PASSWORD`, `NEW_PASSWORD`, `NTHASH`, `COOKIE_VALUE`, `TOKEN` are flagged sensitive and are
excluded from persistence even when "Remember non-secret values" is enabled.

---

## Architecture

```
content/raw/*.html            frozen source export (24 pages, 403,077 chars)
content/raw/*.json            page id / title metadata
content/step-ids.json         stable step-ID registry (slug + exact step title)
content/tool-registry.json    curated tool metadata (executable, package, privileges, caveats)
        │
        ▼  tools/parse.mjs   mask <TOKENS> → tables → inline → fences → sections → steps
                             apply stable IDs, extended fields, drop Related pages,
                             Notion links and stale Quick nav lists
data/commands.json            pages, sections, steps, commands, fields, tags, services
data/variables.json           59-variable registry (label, example, aliases, sensitive)
data/tools.json               tool registry resolved against the commands (pages that use it)
data/meta.json                counts, source checksums, normalization warnings
        │
        ▼  assets/engine.js  pure functions (replacement, filtering, search, grouping)
assets/app.js                 DOM/routing/drawer/copy/persistence/service worker
index.html · assets/app.css   static shell
sw.js · manifest.webmanifest  offline cache
vercel.json                   cache headers; no build step
```

Key behaviours encoded in `assets/engine.js`:

- Tokens match **exactly**: `<TARGET>` is not touched when replacing `<TARGET_IP>`.
- Empty values count as missing; the literal placeholder is preserved.
- Alias tokens resolve to a canonical value (`SHARE` → `SHARE_NAME`, `LPORT` → `LOCAL_PORT`).
- Search requires every word to match somewhere in the step.
- Values are inserted verbatim; no shell escaping or quoting is added.

### Rebuilding after a source edit

The export is intentionally frozen. To refresh it, re-export the 24 pages into
`content/raw/` (the original export used a local POST sink so page bodies never passed
through a third party), then:

```bash
npm run build && npm run validate && npm test
```

If you change `data/*.json` or the shell, bump `VERSION` in `sw.js` so returning visitors
receive the new cache.

---

## Status labels (honest by construction)

| Label | Meaning |
| --- | --- |
| `Lab Tested` | Executed against an authorised lab target; command, output and environment recorded under `audit/`. |
| `Simulated` | Exercised with simulated output or fixtures — syntax and decision logic followed, no real target. |
| `Syntax Checked` | Flags and quoting checked against the installed tool (`--help`); **not executed**. |
| `Environment Dependent` | Correct only where a specific tool, version or host configuration exists; the Prerequisites line names it. |
| `Documented` | Standard technique from the source handbook; not executed and not checked locally. |

`--help` alone is never treated as `Lab Tested`, and no label is upgraded without a recorded run.

Current dataset: **241 `Syntax Checked` · 72 `Documented` · 8 `Environment Dependent` · 0 `Simulated` · 0 `Lab Tested`**.
19 steps are guidance/checklist steps with no command. The UI footer says this explicitly.
`data/meta.json` lists the 3 remaining extraction warnings: two qualified priorities
(`Core (read)`, `Core (AD labs)`) normalized to `Core`, and Machine Notes Step 01, which has
no metadata line because it is an empty template step.

---

## Extraction audit

`data/meta.json` lists 3 warnings, all intentional:

- 2 × qualified priority → `Core`
- 1 × Machine Notes Step 01 has no metadata line (it is an empty template step)

Earlier builds recorded 8 × `Documentation-based` → `Documented`, and the 2026-10-30 build
merged that vocabulary into the five-level status set below.

Other parser normalizations:

- ` ```shen ` (the export's Windows-shell fence) → `cmd`; ` ```text ` is kept as `text`
- Mixed Linux/Windows or shell/REPL blocks are split into one fence per context, so a
  copied block never interleaves `mysql`/`nxc`/PowerShell syntax with the Kali shell
- HTML tables **and Markdown pipe tables** → structured table blocks; inline tokens and
  `<filename>.png`-style placeholders inside cells restored. Before the 2026-10-30 fix, 45
  Markdown tables rendered as one paragraph of pipes with empty cells
- `<br />` → line breaks; fences tracked so `#` comments are never mistaken for headings
- ` ```output ` fences become `step.outputs` / page-level `{type:"output"}` blocks: rendered
  as captured evidence, with no copy button and no variable substitution. The prose
  whitespace tidy is skipped for every `code` value, so command text stays byte-for-byte
  as written (this fixed 19 command blocks that had lost alignment padding or the space
  in `python3 ./setup.py install`)
- `Step 02a` / `Step 06a` supported as string step numbers
- 14 tables and 16 prose code blocks preserved outside step cards
- Every `Related pages` section and every `app.notion.com` link was removed; link labels
  elsewhere are kept as plain text. The stale exported `Quick navigation` lists were also
  dropped, because the UI now renders numbered section chips from the section data.
  Attack Workflow now has 13 sections.
- The frozen SSH export represents its Tunneling and Linux PrivEsc references as local
  `#/p/<slug>` links so they are clickable offline; the Notion page keeps native page
  mentions to the same targets.

### SSH ordering audit (2026-10-23)

The SSH source was reordered from 11 steps to **12 steps / 13 command blocks**. Ten
original command blocks are unchanged; the combined detection block was split so
`ssh-01` is detection-only, the `ssh-auth-methods` check is a second command in `ssh-02`,
and the algorithm check remains `ssh-10`. Detection, authentication behavior, algorithm
enumeration and verbose diagnostics now precede credential use; key identification,
fingerprint validation, permissions and passphrase handling precede the key connection.
A missing `ssh -i` key-connect step was added as `ssh-12`; the legacy-algorithm command
keeps its original `ssh-11` ID. All previous `ssh-01`…`ssh-11` IDs remain stable through
`content/step-ids.json`, and the page now carries purpose, prerequisites, look-for,
success, failure, decision, next, mistake and evidence fields.

The old backup database (`~/oscp-handbook-backup/quick-commands-2026-10-22/`) is kept only
as provenance. It is **not** the site source.

---

## Verification

```bash
npm test
# tests 65 · pass 65 · fail 0
```

Coverage:

- **Engine (13 tests)** — exact replacement, prefix safety, aliases, missing values,
  empty values, special characters, repeated tokens, multi-word search, extended-field
  search, filters, service grouping, step lookup, token validation.
- **Data (19 tests)** — 24 source pages + the generated tool page, unique step/section ids,
  approved statuses/priorities,
  no `Lab Tested`, no leaked fences/masks, all command tokens registered, service tags
  exist, source counts, no Notion links or stale `Related pages`/`Quick navigation` text,
  SSH workflow order and original ID preservation, extended decision fields, stable-ID
  registry coverage.
- **Regression (14 tests)** — every source fence survives byte-for-byte (shell redirections and
  angle-bracket placeholders included), page-level blockquotes stay out of step fields, no
  out-of-range step references, the template/step headings keep their text, and the
  2026-10-30 fixes: FTP three-way anonymous branch, BloodHound GenericAll action, tool
  registry completeness, per-step prerequisite lines, `<filename>.png` preservation,
  PowerShell-vs-cmd labels, the five-level status vocabulary, and the generated tool page.
- **Browser (19 tests, headless Chromium)** — structure (25 nav pages, SMB view), split
  header and centered 1200px content container, variable propagation and missing banners,
  clipboard copy of the rendered command, drawer editing, malformed IPv4/domain rejection,
  priority filter, search + navigation, Quick Navigation chip landing below the sticky
  header with flash/active state, ordered SSH cards and Tunneling route, zero third-party
  requests, offline reload via the service worker, mobile navigation toggle, and the
  Bleeding Edge page (23 ordered steps, 21 output blocks with no copy button and no
  substitution, redactions preserved).

Manual checks: desktop service view, Nmap page, Attack Workflow prose/tables, drawer,
search results, invalid-IP state, 1440/1920/390px layouts, and Quick Navigation on desktop
and mobile.

---

## Deploy to Vercel

The repository is a plain static site; there is no build command.

**Dashboard**

1. Import the `oscp-cheat-sheet` repository (or upload the folder).
2. Framework preset: **Other**.
3. Build command: empty. Output directory: `.` (repository root).
4. Deploy.

**CLI**

```bash
npm i -g vercel
vercel --prod
```

`vercel.json` sets `no-cache` for `sw.js` and `/data/*`, and a short cache for `/assets/*`.
HTTPS (required for the service worker) is automatic on Vercel.

> This site has no authentication. Anything placed in `data/` is public. Never put real
> credentials, hashes, or client data into the JSON.

---

## Known limitations

- **Not lab-validated.** No command in this build has been executed against a live exam
  target. Treat status labels literally.
- **Source drift.** The handbook is frozen at export time; tools and flags change. Verify
  version-sensitive commands.
- **19 guidance steps** have no command by design (checklists, reading steps, templates).
- **Service tagging is primary-tag based.** A step that mentions another protocol in passing
  will not appear in that service view. This is deliberate to keep counts meaningful.
- **Rare variables** (e.g. `RANDOM`, `BASELINE_SIZE`) are fillable in the drawer rather than
  auto-derived.
- **Clipboard** needs permission in some browsers; a textarea fallback is used.
- **Offline is first-visit-dependent.** The service worker must install once while online.
  Browser storage eviction can remove the cache.
- **Not affiliated with OffSec.** OSCP is a trademark of OffSec; this is a personal study
  reference built from the user's own notes.

---

## Layout

```
index.html                  app shell
assets/app.css              dark responsive theme
assets/app.js               UI, routing, drawer, copy, persistence, SW registration
assets/engine.js            pure, tested helpers
data/                       generated JSON (committed for static hosting)
content/raw/                frozen source export + per-page metadata
content/step-ids.json       stable step-ID registry keyed by page + step title
tools/parse.mjs             export → JSON normalizer/parser
tools/validate.mjs          data contract checks
tests/                      node:test suites (engine, data, browser)
sw.js · manifest.webmanifest · icons/icon.svg
vercel.json · package.json
```

### DOM shell

```
header.topbar
├─ .topbar-row                     brand (left) · actions (right, space-between)
│  ├─ .brand                       nav toggle + logo
│  └─ .top-actions                 Reference · search · + Inputs · network badge
└─ .pinned-row > .pinned           TARGET_IP / ATTACKER_IP / DOMAIN row

.main-layout                       display: flex
├─ .sidebar                        fixed 260px column, sticky below the header
└─ main.command-panel#main          flex: 1, fills the remaining width
   └─ .content-container#content    max-width: 1200px; margin: 0 auto; padding: 2rem
      ├─ page header + Quick Navigation chips
      ├─ filters and command cards
      └─ footer
```

The live header height is written to `--topbar-h` with a `ResizeObserver`; the sidebar
and native scroll margins use it, so the sticky offsets stay correct when the header
wraps on narrow screens.
