# How to Check the ADA Harness & ADA Agent

A short, practical checklist. For the full docs see [README.md](README.md); for the deep
testing guide see [TESTING.md](TESTING.md).

---

## 0. One-time setup

```bash
cd "ADA Harness"
npm install
npx playwright install
pip install -r uia/requirements.txt   # Windows only (for UIA)
```

Then start the app you want to scan (default target is `http://localhost:3000`):

```bash
# from the project root
npm start
```

> Point the harness at any app by editing **`config.json`** (`baseUrl` + `routes`).

---

## 1. Check the ADA Harness (scan only)

```bash
cd "ADA Harness"
npm run ada
```

**What it does:** runs all 9 stages — Playwright (axe-core, accessibility snapshot, DOM
snapshot, keyboard traversal) → Windows UI Automation → Accessibility Rule Engine → the 4
specialized engines → summarize → merge → dashboard. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full diagram.

**Check these files appear in `reports/`:**

| File | Confirms |
| ---- | -------- |
| `axe-report.json` | axe-core ran (Stage 1) |
| `playwright-accessibility-tree.json` | Accessibility snapshot ran (Stage 1) |
| `dom-snapshot.json` | Full DOM + computed styles captured (Stage 1) |
| `keyboard-report.json` | Keyboard / Tab-order scan ran (Stage 1) |
| `uia-tree.json` | Windows UI Automation ran (Stage 2) |
| `uia-findings.json` | Accessibility Rule Engine produced findings from all 4 rule sets (Stage 3) |
| `expected-focus-report.json` | Expected Focus Engine ran (Stage 4) |
| `widget-behavior-report.json` | Widget Behavior Engine ran (Stage 5) |
| `focus-management-report.json` | Focus Management Engine ran (Stage 6) |
| `interaction-report.json` | Interaction Prediction Engine ran (Stage 7) |
| `merged-report.json` | Every scanner/engine correlated (with confidence) |
| `dashboard.md` | Human-readable summary |

Open `reports/dashboard.md` → the **Scanner Coverage** table should list every scanner.

**Check keyboard gaps specifically:**

```bash
node -e "const k=require('./reports/keyboard-report.json'); console.log(k.findings.length,'gap(s)'); k.findings.forEach(f=>console.log(f.page,'-',f.issue))"
```

---

## 2. Check the ADA Agent (scan → agent fixes → re-scan)

The **AI Accessibility Fix Agent** (Copilot Agent Mode) does the remediation — it reads
`merged-report.json` and fixes **every** gap in your source. Follow these steps:

```bash
# 1. Scan (snapshots the pre-fix summary, produces merged-report.json, and
#    already regenerates comparison.md + dashboard.md too)
npm run ada
```

```text
# 2. Run the Accessibility Fix Agent in VS Code (Copilot Agent Mode).
#    It reads reports/merged-report.json and fixes ALL gaps — axe, keyboard,
#    UIA rule engine, contrast, headings, and all four specialized engines
#    (expected focus, widget behavior, focus management, interaction
#    prediction) — in your source.
```

```bash
# 3. Re-scan to verify — this also regenerates comparison.md against the
#    pre-fix snapshot from step 1, so there's no separate compare step.
npm run ada
```

**Check:**

| File | Confirms |
| ---- | -------- |
| your `src/` files | Fixes applied by the agent (e.g. `alt`, `aria-label`, keyboard handlers, contrast) |
| `reports/comparison.md` | Resolved / Remaining / New + accessibility score (before vs after) |
| `reports/resolved-issues.json` / `remaining-issues.json` | Machine-readable resolved / remaining |

---

## 3. Quick "is it really working?" test

Add a broken element to any component under `src/`:

```jsx
<img src="/logo.png" />        // missing alt
<button onClick={fn} />         // missing accessible name
```

Then:

```bash
npm run ada          # scan — merged-report.json now lists image-alt / button-name
```

Run the **Accessibility Fix Agent**, then:

```bash
npm run ada          # re-scan — comparison.md shows them under Resolved
```

**Expected:** `merged-report.json` lists `image-alt` / `button-name`, the agent adds
`alt="..."` / `aria-label="..."` to your source, and `comparison.md` shows them under
**Resolved**.

Revert your test edits when done.

---

## 4. All commands

### Setup

| Command | Purpose |
| ------- | ------- |
| `npm install` | Install all Node dependencies (Playwright, axe-core, tsx, TypeScript) |
| `npx playwright install` | Download the Chromium/Firefox/WebKit browser binaries |
| `pip install -r uia/requirements.txt` | Install the `uiautomation` Python package (Windows only, for UIA) |

### Composite workflow

| Command | Runs | Purpose |
| ------- | ---- | ------- |
| `npm run ada` | `scan` → `compare` → `dashboard` | Full scan (all technologies) + before/after comparison + dashboard, in one command |

> **Remediation is done by the AI Accessibility Fix Agent**, not a command. Run
> `npm run ada` to scan, let the agent fix every gap in `src/`, then `npm run ada`
> again — `comparison.md` and `dashboard.md` are both refreshed automatically.

### Individual stages

| Command | Script | Purpose |
| ------- | ------ | ------- |
| `npm run scan` | `scripts/analyze.ts` | Run all 9 stages (Playwright, UIA, Rule Engine, 4 specialized engines, summarize, merge) |
| `npm run summary` | `scripts/generate-summary.ts` | Flatten raw axe output into `summary.json` |
| `npm run uia` | `scripts/uia-scan.ts` | Run only the Windows UI Automation capture (`uia-tree.json`) |
| `npm run uia:rules` | `scripts/uia-rule-engine.ts` | Run only the Accessibility Rule Engine (`uia-tree`/`dom-snapshot`/`a11y-tree` → `uia-findings`) |
| `npm run merge` | `scripts/merge-report.ts` | Rebuild `merged-report.json` from existing reports |
| `npm run compare` | `scripts/compare.ts` | Write `comparison.md` (resolved / remaining / new + score) — already included in `npm run ada` |
| `npm run dashboard` | `scripts/dashboard.ts` | Rebuild `dashboard.md` |
| `npm run auto-fix` | `scripts/auto-fix.ts` | Report-only pass over axe findings (`fixes.json` / `fixes.md`) — never edits source |
| `npm run auto-fix:apply` | `scripts/auto-fix.ts --apply` | Same, but writes the unambiguous safe fixes to source |
| `npm run save-auth` | `scripts/save-auth.ts` | Capture an interactive login session to `auth/session.json` |

### Ad-hoc inspection (Node one-liners)

```bash
# Count findings per scanner
node -e "const m=require('./reports/merged-report.json'); console.log('axe:',m.findings.length,'| keyboard:',m.keyboardFindings.length,'| uia:',m.uiaFindings.length);"

# List keyboard / Tab-order gaps
node -e "const k=require('./reports/keyboard-report.json'); console.log(k.findings.length,'gap(s)'); k.findings.forEach(f=>console.log(f.page,'-',f.issue))"
```

---

## 5. If something looks off

| Symptom | Fix |
| ------- | --- |
| No reports generated | Make sure the app is running at `baseUrl`. |
| `uia-tree.json` → `available: false` | Run on Windows + `pip install -r uia/requirements.txt`. |
| UIA "window not found" | Increase `settleTimeoutMs` in `config.json`. |
| Agent can't find source | Check `appSrcDir` in `config.json` points at your code. |
| Specialized-engine reports are empty/missing findings behind auth | Run `npm run save-auth` once to capture a session, or set `login.enabled: true` for simple forms. |
| Widget Behavior Engine finds no widgets | Set `widgets.accordionSelector` in `config.json` to match your design system's markup. |
