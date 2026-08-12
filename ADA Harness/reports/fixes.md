# Accessibility Fix Report

_Generated: 2026-08-12T05:01:35.832Z_
_Source: merged-report.json_
_Mode: report-only (no source files were modified)_

## Summary

| Metric | Count |
| --- | --- |
| Applied (safe) | 0 |
| Suggested (needs review) | 55 |
| Skipped (duplicate of another finding) | 18 |

## Applied Fixes (by priority)

_No safe fixes were applied._

## Suggested (manual review required)

### CRITICAL (18)

- **[CRITICAL]** `color-contrast` on **Home** `.card:nth-child(1) > .content > .price-rating > h2` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Home** `.card:nth-child(2) > .content > .price-rating > h2` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Home** `.card:nth-child(3) > .content > .price-rating > h2` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Home** `.card:nth-child(4) > .content > .price-rating > h2` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Home** `.card:nth-child(5) > .content > .price-rating > h2` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Home** `.card:nth-child(6) > .content > .price-rating > h2` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `image-alt` on **Home** `span > img` — Add a descriptive alt attribute, e.g. alt="Png;Base6...".
- **[CRITICAL]** `select-name` on **Home** `select` — Add an accessible name, e.g. aria-label or visible text on the <select>.
- **[CRITICAL]** `color-contrast` on **Product Detail** `.price_original` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Product Detail** `.offer` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Product Detail** `.other` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Product Detail** `.product_description > p:nth-child(2)` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `color-contrast` on **Product Detail** `.product_description > p:nth-child(3)` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `image-alt` on **Product Detail** `img` — Add a descriptive alt attribute, e.g. alt="Png;Base6...".
- **[CRITICAL]** `color-contrast` on **Checkout** `button` — Unsafe/complex rule "color-contrast" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright
- **[CRITICAL]** `label` on **Contact** `input[name="name"]` — Added aria-label="Name" to <input> (not applied — auto-fix is in report-only mode; set autoFix.applyFixes: true in config.json, or run "npm run auto-fix:apply", to enable automatic edits) (`app/contact/contact.component.html`)
- **[CRITICAL]** `label` on **Contact** `input[name="email"]` — Added aria-label="Email" to <input> (not applied — auto-fix is in report-only mode; set autoFix.applyFixes: true in config.json, or run "npm run auto-fix:apply", to enable automatic edits) (`app/contact/contact.component.html`)
- **[CRITICAL]** `label` on **Contact** `textarea` — Associate a <label htmlFor="field"> with the input, or add aria-label="Message".

### HIGH (37)

- **[HIGH]** `landmark-one-main` on **Home** `html` — Unsafe/complex rule "landmark-one-main" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/landmark-one-main?application=playwright
- **[HIGH]** `region` on **Home** `h1` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.search-sort-bar` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(1) > .imgBx` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(1) > .content > .productName` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(1) > .content > .price-rating > h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(2) > .imgBx` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(2) > .content > .productName` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(2) > .content > .price-rating > h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(3) > .imgBx` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(3) > .content > .productName` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(3) > .content > .price-rating > h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(4) > .imgBx` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(4) > .content > .productName` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(4) > .content > .price-rating > h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(5) > .imgBx` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(5) > .content > .productName` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(5) > .content > .price-rating > h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(6) > .imgBx` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(6) > .content > .productName` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Home** `.card:nth-child(6) > .content > .price-rating > h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `page-has-heading-one` on **Product Detail** `html` — Unsafe/complex rule "page-has-heading-one" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/page-has-heading-one?application=playwright
- **[HIGH]** `region` on **Product Detail** `.left` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Product Detail** `.product_description > h4` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Product Detail** `.product_description > p:nth-child(2)` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Product Detail** `.product_description > p:nth-child(3)` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Cart** `.total-price` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **About** `h2` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **About** `.hero-card > p` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **About** `.feature-grid` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `p` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `label:nth-child(1)` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `input[name="name"]` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `label:nth-child(3)` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `input[name="email"]` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `label:nth-child(5)` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
- **[HIGH]** `region` on **Contact** `textarea` — Unsafe/complex rule "region" — manual review required. See https://dequeuniversity.com/rules/axe/4.12/region?application=playwright
