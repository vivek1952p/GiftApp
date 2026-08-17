# ADA Harness — Architecture & Workflow

Visual guide to how the harness and agent work. All diagrams reflect the actual
scripts in [`scripts/`](scripts), the spec in [`playwright/`](playwright), and the
config in [`config.json`](config.json).

> Diagrams below are plain Mermaid code fences, which GitHub and VS Code's Markdown
> preview (`Ctrl+Shift+V`) render automatically — no separate image file to keep in
> sync with the source.

---

## Think of it as a factory: four departments, nothing skipped

```mermaid
flowchart TD
    A[Configuration] --> B[Evidence Collection]
    B --> C[Evidence Analysis]
    C --> D[Reporting]
```

- **Configuration** (`config.json`) answers *what should I scan* — base URL, routes,
  browser, WCAG rules, auth strategy. Nothing is tested here; it's the scan blueprint.
- **Evidence Collection** (Playwright + Windows UIA) gathers raw facts: the axe-core
  report, the accessibility tree, the DOM + computed styles, the keyboard Tab order, and
  the Windows accessibility tree.
- **Evidence Analysis** (the Accessibility Rule Engine + five specialized engines)
  interprets that evidence — turning raw facts into findings with a WCAG citation and a
  recommendation.
- **Reporting** correlates every finding into one confidence-scored report and produces
  the dashboard, comparison, and fix suggestions developers actually read.

This separation is what makes the harness modular: a new rule or a new specialized
engine can be added later without touching the core scanning pipeline.

---

## 1. High-level Architecture

```mermaid
flowchart TB
    subgraph CONFIG["⚙️ Configuration (only project-specific file)"]
        CFG[config.json<br/>baseUrl · routes · browser · login/auth · viewport · widgets]
    end

    subgraph APP["🌐 Target Web App (any framework)"]
        WEB[Running app @ baseUrl]
    end

    subgraph COLLECT["🧪 Evidence Collection (deterministic — no AI)"]
        direction TB
        PW[Playwright<br/>browser automation]
        AXE[axe-core<br/>WCAG rule engine]
        SNAP[Accessibility Snapshot<br/>CDP a11y tree]
        DOM[DOM Snapshot<br/>computed styles]
        KB[Keyboard / Tab-order scan]
        UIA[Windows UI Automation<br/>Python uiautomation]
    end

    subgraph ANALYZE["🔎 Evidence Analysis"]
        direction TB
        RE[Accessibility Rule Engine<br/>UIA + DOM + AX-tree + ARIA-pattern rules]
        EFE[Expected Focus Engine]
        WBE[Widget Behavior Engine]
        FME[Focus Management Engine]
        IPE[Interaction Prediction Engine]
        SRE[Screen Reader Engine<br/>real NVDA via guidepup]
    end

    subgraph REPORT["📄 Reporting"]
        MERGE[Report Merger<br/>correlate every source]
        MR[merged-report.json]
        DASH[dashboard.md]
        COV[coverage.md]
    end

    subgraph AGENT["🤖 AI Agent (GitHub Copilot)"]
        FIXAI[Accessibility Fix Agent]
    end

    CFG --> COLLECT
    WEB <--> PW
    PW --> AXE
    PW --> SNAP
    PW --> DOM
    PW --> KB
    PW --> UIA

    AXE --> RE
    SNAP --> RE
    DOM --> RE
    UIA --> RE
    SNAP --> EFE
    KB --> EFE
    PW --> WBE
    PW --> FME
    PW --> IPE

    AXE --> SRE

    RE --> MERGE
    EFE --> MERGE
    WBE --> MERGE
    FME --> MERGE
    IPE --> MERGE
    SRE --> MERGE
    AXE --> MERGE
    SNAP --> MERGE
    DOM --> MERGE
    KB --> MERGE

    MERGE --> MR --> DASH
    MR --> COV
    MR --> FIXAI
    FIXAI -->|edits w/ approval| SRC[application source]
```

---

## 2. Scan Workflow (`npm run ada`)

`npm run ada` runs [`analyze.ts`](scripts/analyze.ts)'s ten-stage scan, then
`compare.ts`, `dashboard.ts`, and `coverage.ts` in that order (`npm run scan &&
npm run compare && npm run dashboard && npm run coverage`) — nothing skips a
stage, though stages 5–9 (the specialized engines) are individually optional and
degrade gracefully if one fails, so a single engine's failure never blocks the
report.

```mermaid
flowchart TD
    START([npm run ada]) --> A[analyze.ts]

    A --> P1["Stage 1 · Playwright spec<br/>accessibility.spec.ts"]
    subgraph SPEC["Per configured route, same browser session"]
        P1 --> LOGIN{"login.enabled?"}
        LOGIN -->|yes| DoLogin[scripted login]
        LOGIN -->|no| Nav["navigate + wait for hydration"]
        DoLogin --> Nav
        Nav --> Shot[screenshot]
        Shot --> RunAxe["axe-core analyze"]
        RunAxe --> RunSnap["accessibility snapshot"]
        RunSnap --> RunDom["DOM + computed styles"]
        RunDom --> RunKb["Tab-order traversal"]
    end
    RunKb --> W1[axe-report.json]
    RunKb --> W3[playwright-accessibility-tree.json]
    RunKb --> W5[dom-snapshot.json]
    RunKb --> W6[keyboard-report.json]

    A --> P2["Stage 2 · generate-summary.ts"]
    W1 --> P2 --> W2[summary.json]

    A --> P3["Stage 3 · uia-scan.ts<br/>headed browser + uia_capture.py"]
    P3 --> W4[uia-tree.json]

    A --> P4["Stage 4 · uia-rule-engine.ts<br/>UIA + DOM + AX-tree + ARIA-pattern rules"]
    W3 --> P4
    W4 --> P4
    W5 --> P4
    P4 --> WF[uia-findings.json]

    A --> P5["Stage 5 · expected-focus-engine.ts"]
    W3 --> P5
    W6 --> P5
    P5 --> EFR[expected-focus-report.json]

    A --> P6["Stage 6 · widget-behavior-engine.ts"]
    P6 --> WBR[widget-behavior-report.json]

    A --> P7["Stage 7 · focus-management-engine.ts"]
    P7 --> FMR[focus-management-report.json]

    A --> P8["Stage 8 · interaction-prediction-engine.ts"]
    P8 --> IPR[interaction-report.json]

    A --> P9["Stage 9 · screen-reader-engine.ts<br/>real NVDA via guidepup"]
    W2 --> P9
    P9 --> SRR[screen-reader-report.json]

    A --> P10["Stage 10 · merge-report.ts"]
    W2 --> P10
    W3 --> P10
    W4 --> P10
    W5 --> P10
    W6 --> P10
    WF --> P10
    EFR --> P10
    WBR --> P10
    FMR --> P10
    IPR --> P10
    SRR --> P10
    P10 --> MR[merged-report.json]

    MR --> CMPGEN[compare.ts] --> CMPMD[comparison.md]
    CMPMD --> DASHGEN[dashboard.ts] --> DASH[dashboard.md]
    DASH --> COVGEN[coverage.ts] --> COV[coverage.md]
    COV --> END([done])
```

**Which stage writes what**

| Stage | Script | Output |
| --- | --- | --- |
| 1 · Playwright + axe-core | `accessibility.spec.ts` | `axe-report.json` |
| 1 · Accessibility Snapshot | `accessibility.spec.ts` (CDP) | `playwright-accessibility-tree.json` |
| 1 · DOM Snapshot | `accessibility.spec.ts` | `dom-snapshot.json` |
| 1 · Keyboard / Tab-order | `accessibility.spec.ts` | `keyboard-report.json` |
| 2 · Summarize | `generate-summary.ts` | `summary.json` |
| 3 · Windows UI Automation | `uia-scan.ts` → `uia_capture.py` | `uia-tree.json` |
| 4 · Accessibility Rule Engine | `uia-rule-engine.ts` (`accessibility-rule-engine/`) | `uia-findings.json` |
| 5 · Expected Focus Engine | `expected-focus-engine.ts` | `expected-focus-report.json` |
| 6 · Widget Behavior Engine | `widget-behavior-engine.ts` | `widget-behavior-report.json` |
| 7 · Focus Management Engine | `focus-management-engine.ts` | `focus-management-report.json` |
| 8 · Interaction Prediction Engine | `interaction-prediction-engine.ts` | `interaction-report.json` |
| 9 · Screen Reader Engine | `screen-reader-engine.ts` | `screen-reader-report.json` |
| 10 · Correlate | `merge-report.ts` | `merged-report.json` |
| Compare | `compare.ts` | `comparison.md` |
| Dashboard | `dashboard.ts` | `dashboard.md` |
| Coverage | `coverage.ts` | `coverage.md` |

`generate-summary.ts` runs right after the Playwright spec (stage 2, not last)
specifically so the Screen Reader Engine at stage 9 has a target list of
missing-name violations to re-verify.

Stages 6–8 (and the UIA capture in stage 3) share one navigation helper,
[`scripts/navigate.ts`](scripts/navigate.ts): a plain `page.goto()` per route by
default (`navigation.mode: "reload"`, correct for any application), or opt-in
same-document SPA navigation (`navigation.mode: "spa"`) for apps with a real
client-side router.

---

## 3. The Accessibility Rule Engine (Stage 4)

`uia-rule-engine.ts` evaluates four independent rule sets over whatever evidence is
available — each one degrades gracefully if its source artifact is missing:

```mermaid
flowchart LR
    UIA[uia-tree.json] --> RUIA[UIA rules]
    DOM[dom-snapshot.json] --> RDOM["DOM rules<br/>color-contrast · text-too-small"]
    AX[playwright-accessibility-tree.json] --> RAX["AX-tree rules<br/>missing alt/name · empty headings"]
    AX --> RARIA["ARIA-pattern rules<br/>tab/tabpanel · menu structure"]
    KB[keyboard-report.json] -.->|suppress false positives| RUIA
    RUIA --> OUT[uia-findings.json]
    RDOM --> OUT
    RAX --> OUT
    RARIA --> OUT
```

DOM and AX-tree rules run on every host OS; only the UIA rule set is Windows-only and
reports `available: false` elsewhere so the rest of the pipeline is unaffected.

---

## 4. Fix + Revalidate Workflow (AI agent)

Remediation is driven by the **Accessibility Fix Agent** (GitHub Copilot Agent
Mode) — there is no deterministic auto-fix command for the full workflow. A
narrower, non-interactive `npm run auto-fix` also exists for the safe-fix subset
only (see below); it's report-only by default and never touches source unless
explicitly told to. The developer
scans, the agent fixes selected gaps in the app source, then the developer re-runs
`npm run ada`, which scans, compares against the pre-fix snapshot, and rebuilds the
dashboard in one command.

```mermaid
flowchart TD
    START([npm run ada]) --> SCAN1[Scan #1<br/>analyze.ts — all 10 stages]
    SCAN1 --> MR1[merged-report.json]

    MR1 --> AGENT[Accessibility Fix Agent<br/>GitHub Copilot]
    subgraph FIXER["AI remediation"]
        AGENT --> PRI["prioritize.ts<br/>Critical/High/Medium/Low"]
        PRI --> KB["knowledge-base.ts<br/>recall known patterns"]
        KB --> AUTO["[AUTO] apply additive fix<br/>alt / aria-label / label / lang"]
        KB --> APPROVE["[APPROVE] diff then apply<br/>contrast / headings / keyboard / widgets"]
        AUTO --> RECORD["record pattern to KB"]
        APPROVE --> RECORD
    end
    AUTO --> SRC["application source edited"]
    APPROVE --> SRC

    SRC --> SCAN2["npm run ada (re-run)"]
    subgraph ADA2["scan && compare && dashboard && coverage"]
        SCAN2 --> S9["all 10 scan stages<br/>(summary.previous.json + merged-report.previous.json<br/>snapshotted first, for an all-scanner diff)"]
        S9 --> MR2["updated merged-report.json"]
        MR2 --> CMP[compare.ts]
        CMP --> CMPMD[comparison.md]
        CMP --> RES[resolved-issues.json]
        CMP --> REM[remaining-issues.json]
        CMPMD --> DASH2["dashboard.ts → dashboard.md"]
        DASH2 --> COV2["coverage.ts → coverage.md"]
    end
    COV2 --> END([done])
```

**Two-tier remediation (the agent's decision boundary)**

`auto-fix.ts`'s `SAFE_RULES` set defines the [AUTO] boundary exactly — everything else
is [APPROVE]. Note this table describes the Accessibility Fix Agent's own judgment
boundary, not `npm run auto-fix`'s default behavior — that script reports every rule,
[AUTO] or [APPROVE], as a suggestion unless `autoFix.applyFixes: true` or `--apply` is
set, and even then only within [AUTO] rules that resolve to exactly one unambiguous
source element project-wide:

| [AUTO] — additive, no judgment required | [APPROVE] — diff then apply (needs judgment) |
| --- | --- |
| `image-alt`, `input-image-alt` | `color-contrast` |
| `button-name`, `input-button-name`, `link-name`, `select-name` | `heading-order`, `page-has-heading-one` |
| `aria-command-name`, `aria-toggle-field-name` | keyboard / focus management findings |
| `label`, `aria-input-field-name` | widget behavior / interaction findings |
| `frame-title`, `html-has-lang` | landmark structure |

---

## 5. Sequence View (end to end)

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant NPM as npm scripts
    participant PW as Playwright
    participant PY as Python UIA
    participant NV as NVDA (guidepup)
    participant FS as reports
    participant AI as Copilot Fix Agent
    participant KB as knowledge-base
    participant SRC as application source

    Dev->>NPM: npm run ada
    NPM->>PW: scan routes — axe, snapshot, DOM, Tab-order
    PW->>FS: axe-report / a11y-tree / dom-snapshot / keyboard-report
    NPM->>FS: summary.json (early, so the Screen Reader Engine has a target list)
    NPM->>PY: capture Windows a11y tree
    PY->>FS: uia-tree.json
    NPM->>FS: uia-findings.json (Rule Engine)
    NPM->>PW: expected-focus / widget-behavior / focus-management / interaction-prediction
    PW->>FS: 4 specialized-engine reports
    NPM->>NV: re-verify missing-name findings (Screen Reader Engine)
    NV->>FS: screen-reader-report.json
    NPM->>FS: merged-report.json
    NPM->>FS: comparison.md + resolved/remaining (compare.ts)
    NPM->>FS: dashboard.md
    NPM->>FS: coverage.md
    Dev->>AI: run Accessibility Fix Agent
    AI->>FS: read merged-report.json
    AI->>KB: recall known fix patterns
    AI->>SRC: apply [AUTO] fixes + [APPROVE] fixes (w/ diff)
    AI->>KB: record applied patterns
    Dev->>NPM: npm run ada (re-scan)
    NPM->>PW: re-scan every stage
    NPM->>FS: comparison.md (diffed against pre-fix snapshot) + dashboard.md + coverage.md
    Dev->>FS: review results
```

---

## 6. Data Flow (artifacts)

```mermaid
flowchart LR
    subgraph inputs["Sources"]
        A[axe-core]
        B["a11y snapshot"]
        C["DOM styles"]
        D["Windows UIA"]
        E["Keyboard / Tab"]
        G["Rule Engine"]
        H["Expected Focus"]
        I["Widget Behavior"]
        J["Focus Management"]
        K["Interaction Prediction"]
        L["Screen Reader (NVDA)"]
    end
    A --> S[summary.json]
    S --> L
    S --> M[merged-report.json]
    B --> M
    C --> M
    D --> M
    E --> M
    G --> M
    H --> M
    I --> M
    J --> M
    K --> M
    L --> M
    M --> CM[comparison.md]
    M --> DB[dashboard.md]
    M --> COV[coverage.md]
    CM --> RES[resolved-issues.json]
    CM --> REM[remaining-issues.json]
```

---

## 7. Where AI fits

```mermaid
flowchart LR
    subgraph NOAI["Deterministic (no AI)"]
        SCAN["Evidence collection + analysis<br/>(10 stages)"]
        REP["All .md / .json reports"]
    end
    subgraph AIREM["AI remediation (you trigger)"]
        COP["Copilot Accessibility Fix Agent<br/>.github/agents/accessibility-fix.agent.md"]
    end
    MR[merged-report.json] --> NOAI
    MR --> AIREM
    COP -->|all fixes, w/ approval| SRC["application source"]
```

- **Evidence collection and analysis are 100% deterministic** — no AI, fully repeatable,
  identical output for identical input.
- **All remediation is done by the AI agent**: the single Copilot agent resolves every
  gap (additive labels **and** nuanced fixes like contrast, headings, keyboard, and
  widget behavior) with your approval, using the same `merged-report.json`.

---

## Quick reference

| Command | Does |
| --- | --- |
| `npm run ada` | Full 10-stage scan → `compare` → `dashboard` → `coverage` — the one command that leaves every report fresh |
| `npm run scan` | The 10-stage scan only (no compare/dashboard/coverage regeneration) |
| `npm run summary` | Rebuild `summary.json` from the existing raw axe report (snapshots the prior one first) |
| `npm run uia` | Windows UI Automation capture only |
| `npm run uia:rules` | Rebuild `uia-findings.json` from existing artifacts |
| `npm run screen-reader` | Re-verify missing-name findings against real NVDA (Screen Reader Engine) only |
| `npm run merge` | Rebuild `merged-report.json` |
| `npm run compare` | Write `comparison.md` (resolved / remaining / new + score) — already included in `npm run ada`; run it standalone only to re-diff without a full re-scan |
| `npm run dashboard` | Rebuild `dashboard.md` |
| `npm run coverage` | Rebuild `coverage.md` (WCAG 2.2 A/AA success-criterion coverage) |
| `npm run auto-fix` | Report-only pass over axe findings (`fixes.json` / `fixes.md`) — never edits source |
| `npm run auto-fix:apply` | Same, but writes the unambiguous [AUTO] fixes to source (equivalent to `autoFix.applyFixes: true`) |
| `npm run save-auth` | Capture an interactive login session to `auth/session.json` |

> Full interactive remediation (explain → plan → fix → revalidate) is performed by the
> **Accessibility Fix Agent** (Copilot Agent Mode) — `npm run auto-fix` only covers the
> deterministic, axe-only safe-fix subset, and only writes to source when explicitly
> told to.

> Mermaid diagrams render automatically in VS Code's Markdown preview
> (`Ctrl+Shift+V`) and on GitHub.
