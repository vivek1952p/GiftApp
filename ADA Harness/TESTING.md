# ADA Harness — Testing Guide

This guide explains how to validate the full pipeline end to end: **Playwright**
(axe-core, accessibility snapshot, DOM snapshot, keyboard traversal), **Windows UI
Automation**, the **Accessibility Rule Engine**, the **four specialized engines**
(Expected Focus, Widget Behavior, Focus Management, Interaction Prediction), the
**merged report**, the **AI-generated fixes**, and the **comparison report**. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full stage-by-stage diagram.

---

## 1. Prerequisites

```bash
cd "ADA Harness"
npm install
npx playwright install
pip install -r uia/requirements.txt   # Windows only (Windows UI Automation)
```

You also need a **running web application** reachable at the `baseUrl` in
[`config.json`](config.json) — there is no sample app bundled with the harness itself; the
steps below use generic routes as an example, but they apply the same way to whatever
project you point `config.json` at, in any framework.

---

## 2. Test on Your Project

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
cd "ADA Harness"
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

### 4.6 Verify the Accessibility Rule Engine

Open `reports/uia-findings.json` — findings from all four rule sets (UIA, DOM,
AX-tree, ARIA-pattern), each with `ruleId`, `severity`, `wcag`, `recommendation`. DOM
and AX-tree rules should produce findings on every platform, even without Windows UIA.
The engine is scoped to the app document subtree (`uia.documentOnly`).

### 4.7 Verify the Expected Focus Engine

Open `reports/expected-focus-report.json`. *Check:* `allGaps` lists any Tab-navigable
element the accessibility tree expected but the keyboard scan never reached, plus any
Tab-reachable element with no accessible name. To force a gap, give a `<button>` a
`tabindex="-1"` — it should appear here even though axe may not flag it. Repeated
same-named elements (e.g. per-row "Edit" buttons in a table) are compared by count, not
presence — to verify this, make only *some* instances of a repeated component
unreachable (e.g. `tabindex="-1"` on 2 of 5 identical buttons); the finding should report
the numeric deficit ("2 of 5 ... only 3 instance(s) reached"), not silently pass because
the other 3 worked.

### 4.8 Verify the Widget Behavior Engine

Open `reports/widget-behavior-report.json`. If your app has a tab, menu, accordion,
dialog, or combobox widget, *check* that a working one produces **zero** findings, and a
widget whose keyboard handlers you temporarily remove produces a finding citing the
WAI-ARIA APG pattern it violates. The accordion selector is configurable via
`widgets.accordionSelector` in `config.json` — point it at your own component if the
generic default (`details > summary, [role="button"][aria-expanded]`) doesn't match your
markup. The menu check only runs for triggers using the standard `aria-haspopup="menu"`
or `aria-controls`-pointing-at-a-`role="menu"` association — it won't test a menu that
isn't marked up that way. The Tab check verifies focus actually moves to a *different*
tab on ArrowRight, not just that focus remains on something with `role="tab"` — to force
a finding, temporarily remove the ArrowRight handler from a tablist; a completely inert
widget should now be caught (previously it wasn't, since the starting tab already had the
right role).

### 4.9 Verify the Focus Management Engine

Open `reports/focus-management-report.json`. *Check:*
- `scenario: "route-navigation"` — focus fell back to `<body>` after navigating, instead
  of landing on a heading, skip-link, or landmark.
- `scenario: "focus-visible"` — the sweep Tabs through **every** reachable element on the
  page and flags any where none of outline/box-shadow/border/background/transform changes
  between focused and unfocused states. To force one, add `outline: none` to a component's
  CSS with no replacement indicator — it should appear here (and *not* appear if you use
  `box-shadow` instead, since the sweep checks for any visual change, not just `outline`).
- `scenario: "modal-focus-restoration"` — only checked for dialogs whose trigger uses
  `aria-haspopup="dialog"` or `aria-controls` pointing at the dialog. To force one, open a
  correctly-marked-up dialog, close it with Escape, and temporarily remove the code that
  restores focus to the trigger.

### 4.10 Verify the Interaction Prediction Engine

Open `reports/interaction-report.json`. This only tests **custom** (non-native)
interactive elements, any tag name — a `<div role="button">` (or a custom element like
`<ds-button role="button">`) without a keydown handler should produce a finding; a native
`<button>` never will (browsers handle it for free). *Check:* the finding cites the
`expectedKey` (Enter/Space) that failed to activate the element. Up to 4 instances are
sampled per page and **every** sampled instance is tested — to verify this, break the
keydown handler on only some instances of a repeated custom control; the finding's issue
text should note "N of M sampled instance(s) failed" rather than disappearing because
other instances still work.

---

## 5. Verify the AI-Generated Fixes

Remediation is driven by the **Accessibility Fix Agent** (Copilot Agent Mode), not a
command. Scan, run the agent, then re-scan — `npm run ada` already runs `compare`
internally, so a single re-run produces the before/after comparison too:

```bash
npm run ada        # scan (produces merged-report.json, comparison.md, dashboard.md)
# then run the Accessibility Fix Agent in VS Code (Copilot Agent Mode)
npm run ada        # re-scan — comparison.md now diffs against the pre-fix snapshot
```

*Check:*
- The agent resolves **every** gap — axe, keyboard, UIA rule engine, and all four
  specialized engines — applying **[AUTO]** fixes directly and **[APPROVE]** fixes
  (contrast, headings, landmarks, keyboard, widget behavior) after showing a before/after
  diff.
- Your source files under `appSrcDir` now contain the fixes, e.g.:
  - `<img src="/logo.png" alt="Logo" />`
  - `<button aria-label="...">` / visible text
  - `<input ... aria-label="Email" />`
- `reports/comparison.md` shows the resolved findings and an improved score.

### Interactive AI agent

Open [`.github/agents/accessibility-fix.agent.md`](../.github/agents/accessibility-fix.agent.md)
in VS Code with GitHub Copilot Agent Mode to have the agent explain every finding from
`merged-report.json` (scanner/engine, source file, component, WCAG rule, why, who is
impacted, fix, and whether it is safe) and let you choose what to fix before it edits
anything.

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
| `uia-findings.json` | Findings from all 4 rule sets (UIA/DOM/AX-tree/ARIA-pattern) with `ruleId` / `severity` / `wcag` / `recommendation`. |
| `dom-snapshot.json` | Non-zero elements; computed colours for contrast findings. |
| `keyboard-report.json` | Per-page `reached`/`interactiveTotal`; `unreachable` lists real gaps. |
| `expected-focus-report.json` | `allGaps` reflects real Tab-order/AX-tree mismatches. |
| `widget-behavior-report.json` | Zero findings for correctly-behaving widgets; real findings when handlers are broken. |
| `focus-management-report.json` | Flags focus falling to `<body>` after navigation or missing `:focus-visible` outlines. |
| `interaction-report.json` | Flags only custom (non-native) elements that don't respond to Enter/Space. |
| `merged-report.json` | Findings show `detectedBy` + `verifiedIn` + `confidence`; includes `keyboardFindings`, `uiaFindings`, `expectedFocusGaps`, `widgetFindings`, `focusManagementFindings`, `interactionFindings`. |
| `comparison.md` | Resolved > 0, New = 0, score improved. |
| `dashboard.md` | Scanner-coverage table shows all scanners/engines used. |
