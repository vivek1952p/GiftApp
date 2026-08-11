# ♿ Accessibility Dashboard

_Generated: 2026-08-11T10:22:23.072Z_
_Target: http://localhost:4200_

## Summary

| Metric | Value |
| --- | --- |
| Pages Scanned | 7 |
| Total Findings | 121 |
| Critical | 14 |
| Serious | 46 |
| Moderate | 60 |
| Minor | 1 |
| **Accessibility Score** | **0/100** |

_Covers all 7 scanners (axe-core + the Accessibility Rule Engine + keyboard + all 4 specialized engines). See_ `comparison.md` _for how this total changed since the previous scan._

## Scanner Coverage

| Scanner | Status |
| --- | --- |
| axe-core (WCAG 2.1 AA) | ✅ used |
| Playwright Accessibility Tree | ✅ 523 nodes |
| Windows UI Automation | ✅ 1938 nodes |
| Full DOM Snapshot | ✅ 57 elements |
| Accessibility Rule Engine | ✅ 31 finding(s) |
| Keyboard / Tab-order | ✅ 0 finding(s) |
| Expected Focus Engine | ✅ 9 gap(s) |
| Widget Behavior Engine | ✅ 0 finding(s) |
| Focus Management Engine | ✅ 8 finding(s) |
| Interaction Prediction Engine | ✅ 0 finding(s) |
| Findings confirmed by all scanners | 4 |

## Findings by Page (All Scanners)

| Page | Findings |
| --- | --- |
| Home | 39 |
| Product Detail | 19 |
| Cart | 10 |
| Checkout | 12 |
| Login | 5 |
| About | 10 |
| Contact | 25 |
| (3 pages: Home, Checkout, Contact) | 1 |

## Findings by Rule / Category (All Scanners)

_Rows prefixed_ `expected-focus:` / `widget-behavior:` / `focus-management:` / `interaction:` _come from the specialized engines, which don't use axe rule ids — the suffix is that engine's own scenario/widget/role label instead._

| Rule | Count |
| --- | --- |
| `region` | 36 |
| `color-contrast` | 14 |
| `dom-color-contrast` | 14 |
| `ax-image-alt` | 8 |
| `image-alt` | 7 |
| `expected-focus:2.1.1` | 7 |
| `focus-management:route-navigation` | 7 |
| `landmark-one-main` | 6 |
| `page-has-heading-one` | 6 |
| `ax-interactive-name` | 4 |
| `label` | 3 |
| `uia-input-name` | 3 |
| `expected-focus:4.1.2` | 2 |
| `select-name` | 1 |
| `uia-image-name` | 1 |
| `uia-disabled-interactive` | 1 |
| `focus-management:focus-visible` | 1 |
