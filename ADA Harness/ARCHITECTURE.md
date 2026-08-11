# ADA Harness — Architecture & Workflow

Visual guide to how the harness and agent work. All diagrams reflect the actual
scripts in [`scripts/`](scripts), the spec in [`playwright/`](playwright), and the
config in [`config.json`](config.json).

> **📌 Diagrams:** Each section shows a **rendered image** (works in any Markdown preview and
> on GitHub — no extension needed), followed by the editable **Mermaid source**. If the
> Mermaid source block looks like code, that's fine — the image above it is the diagram.

---

## 1. High-level Architecture

![High-level architecture](diagrams/01-architecture.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TB
    subgraph CONFIG["⚙️ Configuration (only project-specific file)"]
        CFG[config.json<br/>baseUrl · routes · browser · login · viewport]
    end

    subgraph APP["🌐 Target Web App (any framework)"]
        WEB[Running app @ baseUrl]
    end

    subgraph HARNESS["🧪 ADA Harness (deterministic — no AI)"]
        direction TB
        PW[Playwright<br/>browser automation]
        AXE[axe-core<br/>WCAG rule engine]
        SNAP[Accessibility Snapshot<br/>CDP a11y tree]
        DOM[DOM Snapshot<br/>computed styles]
        UIA[Windows UI Automation<br/>Python uiautomation]
        MERGE[Report Merger<br/>correlate all sources]
    end

    subgraph REPORTS["📄 Reports"]
        MR[merged-report.json]
        DASH[dashboard.md]
    end

    subgraph AGENT["🤖 AI Agent (GitHub Copilot)"]
        FIXAI[Accessibility Fix Agent]
    end

    CFG --> HARNESS
    WEB <--> PW
    PW --> AXE --> MERGE
    PW --> SNAP --> MERGE
    PW --> DOM --> MERGE
    PW --> UIA --> MERGE
    MERGE --> MR --> DASH
    MR --> FIXAI
    FIXAI -->|edits w/ approval| SRC[src/ source code]
```

</details>

---

## 2. Scan Workflow (`npm run ada`)

The orchestrator [`analyze.ts`](scripts/analyze.ts) runs four technologies, then
summarizes and merges.

![Scan workflow](diagrams/02-scan-workflow.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    START([npm run ada]) --> A[analyze.ts]

    A --> P1["1 · Playwright spec<br/>accessibility.spec.ts"]
    subgraph SPEC["Per configured route"]
        P1 --> LOGIN{"login.enabled?"}
        LOGIN -->|yes| DoLogin[authenticate]
        LOGIN -->|no| Nav["navigate + wait hydrate"]
        DoLogin --> Nav
        Nav --> Shot[screenshot]
        Shot --> RunAxe["axe-core analyze"]
        RunAxe --> RunSnap["CDP accessibility snapshot"]
        RunSnap --> RunDom["DOM + computed styles"]
        RunDom --> RunKb["Tab-order traversal"]
    end
    RunKb --> W1[axe-report.json]
    RunKb --> W3[playwright-accessibility-tree.json]
    RunKb --> W5[dom-snapshot.json]
    RunKb --> W6[keyboard-report.json]

    A --> P2["2 · uia-scan.ts<br/>headed Edge + uia_capture.py"]
    P2 --> W4[uia-tree.json]
    W4 --> RE["2b · uia-rule-engine.ts<br/>infer findings from UIA"]
    RE --> WF[uia-findings.json]

    A --> P3["3 · generate-summary.ts"]
    W1 --> P3 --> W2[summary.json]

    A --> P4["4 · merge-report.ts"]
    W2 --> P4
    W3 --> P4
    W4 --> P4
    W5 --> P4
    W6 --> P4
    WF --> P4
    P4 --> MR[merged-report.json]

    MR --> DASHGEN[dashboard.ts] --> DASH[dashboard.md]
    DASH --> END([done])
```

</details>

**Which technology writes what**

| Stage | Script | Output |
| --- | --- | --- |
| Playwright + axe-core | `accessibility.spec.ts` | `axe-report.json` |
| Accessibility Snapshot | `accessibility.spec.ts` (CDP) | `playwright-accessibility-tree.json` |
| DOM Snapshot | `accessibility.spec.ts` | `dom-snapshot.json` |
| Keyboard / Tab-order | `accessibility.spec.ts` | `keyboard-report.json` |
| Windows UI Automation | `uia-scan.ts` → `uia_capture.py` | `uia-tree.json` |
| UIA Rule Engine | `uia-rule-engine.ts` | `uia-findings.json` |
| Summarize | `generate-summary.ts` | `summary.json` |
| Correlate | `merge-report.ts` | `merged-report.json` |
| Dashboard | `dashboard.ts` | `dashboard.md` |

---

## 3. Fix + Revalidate Workflow (AI agent)

Remediation is driven by the **Accessibility Fix Agent** (GitHub Copilot Agent
Mode) — there is no deterministic auto-fix command. The developer scans, the
agent fixes **every** gap in `src/`, then the developer re-scans and compares.

![Fix and revalidate workflow](diagrams/03-fix-workflow.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    START([npm run ada]) --> SCAN1[Scan #1<br/>analyze.ts]
    SCAN1 --> MR1[merged-report.json]

    MR1 --> AGENT[Accessibility Fix Agent<br/>GitHub Copilot]
    subgraph FIXER["AI remediation"]
        AGENT --> PRI["prioritize.ts<br/>Critical/High/Medium/Low"]
        PRI --> KB["knowledge-base.ts<br/>recall known patterns"]
        KB --> AUTO["[AUTO] apply additive fix<br/>alt / aria-label / label / title"]
        KB --> APPROVE["[APPROVE] diff then apply<br/>contrast / headings / keyboard"]
        AUTO --> RECORD["record pattern to KB"]
        APPROVE --> RECORD
    end
    AUTO --> SRC["src/ edited"]
    APPROVE --> SRC

    SRC --> SCAN2["Scan #2<br/>npm run ada re-runs all technologies"]
    SCAN2 --> MR2["updated merged-report.json"]
    MR2 --> CMP[compare.ts]
    CMP --> CMPMD[comparison.md]
    CMP --> RES[resolved-issues.json]
    CMP --> REM[remaining-issues.json]
    CMPMD --> DASH2["dashboard.ts → dashboard.md"]
    DASH2 --> END([done])
```

</details>

**Two-tier remediation (the agent's decision boundary)**

| [AUTO] — applied directly (safe, additive) | [APPROVE] — diff then apply (needs judgment) |
| --- | --- |
| `image-alt`, `input-image-alt` | `color-contrast` |
| `button-name`, `link-name`, `select-name` | `heading-order`, `page-has-heading-one` |
| `label`, `aria-input-field-name` | keyboard / focus management |
| `frame-title`, `html-has-lang` | landmark / region structure |

---

## 4. Sequence View (end to end)

![Sequence view](diagrams/04-sequence.svg)

<details><summary>Mermaid source</summary>

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant NPM as npm scripts
    participant PW as Playwright Edge
    participant PY as Python UIA
    participant FS as reports
    participant AI as Copilot Fix Agent
    participant KB as knowledge-base
    participant SRC as src

    Dev->>NPM: npm run ada
    NPM->>PW: scan routes axe + snapshot + DOM + Tab-order
    PW->>FS: axe-report / a11y-tree / dom-snapshot / keyboard-report
    NPM->>PY: capture Windows a11y tree
    PY->>FS: uia-tree.json
    NPM->>FS: uia-findings.json (Rule Engine)
    NPM->>FS: summary.json + merged-report.json
    Dev->>AI: run Accessibility Fix Agent
    AI->>FS: read merged-report.json
    AI->>KB: recall known fix patterns
    AI->>SRC: apply [AUTO] fixes + [APPROVE] fixes (w/ diff)
    AI->>KB: record applied patterns
    Dev->>NPM: npm run ada (re-scan) + npm run ada:compare
    NPM->>PW: re-scan all technologies
    NPM->>FS: comparison.md + resolved/remaining + dashboard.md
    Dev->>FS: review results
```

</details>

---

## 5. Data Flow (artifacts)

![Data flow](diagrams/05-data-flow.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    subgraph inputs["Sources"]
        A[axe-core]
        B["a11y snapshot"]
        C["DOM styles"]
        D["Windows UIA"]
        E["Keyboard / Tab"]
        G["UIA Rule Engine"]
    end
    A --> S[summary.json]
    S --> M[merged-report.json]
    B --> M
    C --> M
    D --> M
    E --> M
    G --> M
    M --> CM[comparison.md]
    M --> DB[dashboard.md]
    CM --> RES[resolved-issues.json]
    CM --> REM[remaining-issues.json]
```

</details>

---

## 6. Where AI fits

![Where AI fits](diagrams/06-where-ai-fits.svg)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    subgraph NOAI["Deterministic (no AI)"]
        SCAN["Scan · 4 technologies"]
        REP["All .md / .json reports"]
    end
    subgraph AIREM["AI remediation (you trigger)"]
        COP["Copilot Accessibility Fix Agent<br/>.github/agents/accessibility-fix.agent.md"]
    end
    MR[merged-report.json] --> NOAI
    MR --> AIREM
    COP -->|all fixes, w/ approval| SRC["src/"]
```

</details>

- **Scanning and reports are 100% deterministic** — no AI, fully repeatable.
- **All remediation is done by the AI agent**: the single Copilot agent resolves
  every gap (additive labels **and** nuanced fixes like contrast / headings /
  keyboard) with your approval, using the same `merged-report.json`.

---

## Quick reference

| Command | Does |
| --- | --- |
| `npm run ada` | Scan (4 technologies) → merge → dashboard |
| `npm run uia` | Windows UI Automation capture only |
| `npm run merge` | Rebuild `merged-report.json` |
| `npm run compare` | Write `comparison.md` (resolved / remaining / new + score) |
| `npm run dashboard` | Rebuild `dashboard.md` |

> Remediation is performed by the **Accessibility Fix Agent** (Copilot Agent Mode),
> not a command — scan, let the agent fix every gap, then re-scan and compare.

> Mermaid diagrams render automatically in VS Code's Markdown preview
> (`Ctrl+Shift+V`) and on GitHub.
