# ADA Harness — Testing Guide

This guide explains how to validate the full four-technology pipeline end to end:
**Playwright + axe-core + Playwright Accessibility Snapshot + Windows UI Automation**,
the **merged report**, the **AI-generated fixes**, and the **comparison report**.

---

## 1. Prerequisites

```bash
cd ada-harness
npm install
npx playwright install
pip install -r uia/requirements.txt   # Windows only (Technology 4)
```

You also need a **running web application** reachable at the `baseUrl` in
[`config.json`](config.json). The steps below use the bundled sample React app, but any
framework works.

---

## 2. Test on a Sample React Project

### Step 1 — Point the harness at the app

Edit [`config.json`](config.json):

```jsonc
{
  "baseUrl": "http://localhost:3000",
  "appSrcDir": "../src",
  "routes": [
    { "name": "Home",  "path": "/" },
    { "name": "Login", "path": "/login" }
  ]
}
```

### Step 2 — Start the app

```bash
# from the project root
npm start
```

*Expected:* the app is available at `http://localhost:3000`.

### Step 3 — Run a full scan

```bash
cd ada-harness
npm run ada
```

*Expected:*
- Playwright scans each route (axe-core + accessibility snapshot).
- A **headed Chromium window briefly opens** for the UIA capture.
- `reports/` now contains `axe-report.json`, `summary.json`,
  `playwright-accessibility-tree.json`, `uia-tree.json`, `merged-report.json`, and
  `dashboard.md`.

---

## 3. Intentionally Introduce Accessibility Issues

To confirm the harness detects real problems, temporarily add violations to a component
under `src/` (for example a page component):

```jsx
// Missing alt (image-alt)
<img src="/logo.png" />

// Missing accessible name (button-name)
<button onClick={handleClick} />

// Missing form label (label)
<input type="email" name="email" />

// Missing link text (link-name)
<a href="/cart"><span className="icon-cart" /></a>
```

Save the file so the dev server hot-reloads, then re-run:

```bash
npm run ada
```

*Expected:* `summary.json` / `merged-report.json` now report `image-alt`, `button-name`,
`label`, and `link-name` findings.

---

## 4. Verify Each Technology's Output

### 4.1 Verify axe results

Open `reports/summary.json`:

```jsonc
{
  "totalViolations": 4,
  "violations": [
    { "ruleId": "image-alt", "impact": "critical", "target": "img", "page": "Home" }
    // ...
  ]
}
```

*Check:* each intentionally-introduced issue appears with the correct `ruleId` and `impact`.

### 4.2 Verify the Playwright Accessibility Snapshot

Open `reports/playwright-accessibility-tree.json`:

```jsonc
{
  "results": [
    {
      "page": "Home",
      "nodeCount": 400,
      "tree": { "role": "WebArea", "name": "...", "children": [ /* roles + names */ ] }
    }
  ]
}
```

*Check:* the offending controls appear with an **empty `name`** (e.g. a `button` node with
`"name": ""`), confirming the browser exposes no accessible name.

### 4.3 Verify the Windows UI Automation Tree

Open `reports/uia-tree.json`:

```jsonc
{
  "available": true,
  "platform": "win32",
  "results": [
    {
      "page": "Home",
      "available": true,
      "nodeCount": 380,
      "window": "... - Chromium",
      "tree": { "role": "PaneControl", "name": "", "automationId": "", "children": [ /* ... */ ] }
    }
  ]
}
```

*Check:*
- `available: true` and `nodeCount > 0` (on Windows with `uiautomation` installed).
- Controls expose `name`, `role` (control type), and `automationId`.
- A control missing an accessible name shows an empty `name` — this is what a Windows screen
  reader would announce.

> On non-Windows hosts you will see `available: false` with an explanatory `error`. The
> pipeline still completes.

### 4.4 Verify the Merged Report

Open `reports/merged-report.json`:

```jsonc
{
  "sources": { "axe": true, "playwrightTree": true, "uia": true },
  "trees": { "playwrightNodeCount": 400, "uiaNodeCount": 380, "uiaAvailable": true },
  "findings": [
    {
      "ruleId": "button-name",
      "detectedBy": ["axe-core"],
      "verifiedIn": { "playwrightTree": "confirmed", "uia": "confirmed" },
      "correlation": "Confirmed by axe-core, Playwright Accessibility Tree, and Windows UI Automation."
    }
  ]
}
```

*Check:* name-related findings show `verifiedIn.playwrightTree: "confirmed"` and, on Windows,
`verifiedIn.uia: "confirmed"` — proving the correlation across all scanners.

### 4.5 Verify the Keyboard / Tab-order scan

Open `reports/keyboard-report.json`. Each page has `reached` vs `interactiveTotal` and any
`unreachable` controls:

```bash
node -e "const k=require('./reports/keyboard-report.json'); k.results.forEach(r=>console.log(r.page, r.reached+'/'+r.interactiveTotal, 'unreachable', r.unreachable.length))"
```

*Check:* on a clean app every page shows `reached === interactiveTotal` (0 gaps). To force a
gap, add a `<div role="button" onClick=...>` **without** `tabIndex` — it will appear as a
`keyboard-unreachable` finding (WCAG 2.1.1).

### 4.6 Verify the UIA Rule Engine

Open `reports/uia-findings.json` — accessibility issues inferred from raw UIA properties
(missing names, non-focusable controls). Each finding has `ruleId`, `severity`, `wcag`,
`recommendation`. The engine is scoped to the app document subtree (`uia.documentOnly`).

---

## 5. Verify the AI-Generated Fixes

Remediation is driven by the **Accessibility Fix Agent** (Copilot Agent Mode), not a
command. Scan, run the agent, then re-scan and compare:

```bash
npm run ada        # scan (produces merged-report.json)
# then run the Accessibility Fix Agent in VS Code (Copilot Agent Mode)
npm run ada        # re-scan all technologies
npm run compare    # before/after comparison
```

*Check:*
- The agent resolves **every** gap — axe, keyboard, and UIA — applying **[AUTO]** fixes
  directly and **[APPROVE]** fixes (contrast, headings, landmarks, keyboard) after showing
  a before/after diff.
- Your source files under `src/` now contain the fixes, e.g.:
  - `<img src="/logo.png" alt="Logo" />`
  - `<button aria-label="...">` / visible text
  - `<input ... aria-label="Email" />`
- `reports/comparison.md` shows the resolved findings and an improved score.

### Interactive AI agent

Open [`prompts/accessibility-fix.prompt.md`](prompts/accessibility-fix.prompt.md) in VS Code
with GitHub Copilot Agent Mode to have the agent explain every finding from
`merged-report.json` (scanner, source file, component, WCAG rule, why, who is impacted, fix,
and whether it is safe).

---

## 6. Verify the Comparison Report

Open `reports/comparison.md`:

```markdown
## Accessibility Score
| Scan     | Total Violations | Score  |
| Previous | 4                | 60/100 |
| Current  | 0                | 100/100|

## ✅ Resolved Issues (4)
## ⚠️ Remaining Issues (0)
## 🆕 New Issues (0)
```

*Check:*
- **Resolved Issues** lists the fixes the agent applied.
- **Remaining Issues** lists anything left (e.g. items the user declined).
- **New Issues** is empty (fixes did not introduce regressions).
- The **Accessibility Score** increased.

---

## 7. Clean Up

Revert the intentional issues you added in step 3 (or discard the changes) and re-run
`npm run ada` to confirm a clean baseline.

---

## 8. Test Matrix (What "Good" Looks Like)

| Artifact | Success criteria |
| -------- | ---------------- |
| `axe-report.json` | Raw results present for every configured route. |
| `summary.json` | Flattened violations with rule id, impact, target, html. |
| `playwright-accessibility-tree.json` | Non-zero `nodeCount`; offending controls show empty `name`. |
| `uia-tree.json` | `available: true` on Windows; controls expose name/role/automationId. |
| `uia-findings.json` | Rule Engine findings with `ruleId` / `severity` / `wcag` / `recommendation`. |
| `dom-snapshot.json` | Non-zero elements; computed colours for contrast findings. |
| `keyboard-report.json` | Per-page `reached`/`interactiveTotal`; `unreachable` lists real gaps. |
| `merged-report.json` | Findings show `detectedBy` + `verifiedIn` + `confidence`; includes `keyboardFindings` + `uiaFindings`. |
| `comparison.md` | Resolved > 0, New = 0, score improved. |
| `dashboard.md` | Scanner-coverage table shows all scanners used. |
