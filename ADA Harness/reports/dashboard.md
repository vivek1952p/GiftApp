# ♿ Accessibility Dashboard

_Generated: 2026-08-12T05:23:12.092Z_
_Target: http://localhost:4200_

## Summary

| Metric | Value |
| --- | --- |
| Pages Scanned | 7 |
| Total Findings | 79 |
| Critical | 14 |
| Serious | 35 |
| Moderate | 29 |
| Minor | 1 |
| **Accessibility Score** | **0/100** |

_Covers all 7 scanners (axe-core + the Accessibility Rule Engine + keyboard + all 4 specialized engines). See_ `comparison.md` _for how this total changed since the previous scan._

## Scanner Coverage

| Scanner | Status |
| --- | --- |
| axe-core (WCAG 2.1 AA) | ✅ used |
| Playwright Accessibility Tree | ✅ 306 nodes |
| Windows UI Automation | ✅ 1921 nodes |
| Full DOM Snapshot | ✅ 33 elements |
| Accessibility Rule Engine | ✅ 21 finding(s) |
| Keyboard / Tab-order | ✅ 0 finding(s) |
| Expected Focus Engine | ✅ 9 gap(s) |
| Widget Behavior Engine | ✅ 0 finding(s) |
| Focus Management Engine | ✅ 8 finding(s) |
| Interaction Prediction Engine | ✅ 0 finding(s) |
| Findings confirmed by all scanners | 4 |

## Findings by Page (All Scanners)

| Page | Findings |
| --- | --- |
| Home | 11 |
| Product Detail | 5 |
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
| `region` | 15 |
| `ax-image-alt` | 9 |
| `image-alt` | 7 |
| `expected-focus:2.1.1` | 7 |
| `focus-management:route-navigation` | 7 |
| `landmark-one-main` | 6 |
| `page-has-heading-one` | 6 |
| `ax-interactive-name` | 4 |
| `color-contrast` | 3 |
| `label` | 3 |
| `uia-input-name` | 3 |
| `dom-color-contrast` | 3 |
| `expected-focus:4.1.2` | 2 |
| `select-name` | 1 |
| `uia-image-name` | 1 |
| `uia-disabled-interactive` | 1 |
| `focus-management:focus-visible` | 1 |
