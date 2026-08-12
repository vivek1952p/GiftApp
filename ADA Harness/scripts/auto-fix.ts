/**
 * ============================================================================
 * ADA Harness — Auto Fix Engine (Steps 4 & 5)
 * ============================================================================
 *
 * Reads the axe-correlated findings from reports/merged-report.json (falling
 * back to reports/summary.json if the merged report isn't available yet) and,
 * for every violation, attempts to locate the offending element in the
 * application source under `appSrcDir` and fix it. File types eligible for
 * fixing are config-driven (`autoFix.sourceExtensions` in config.json) — not
 * tied to any single framework.
 *
 * Scope: this engine only handles axe-core rule ids, since those are the only
 * findings with a known, mechanical, additive fix strategy (add an attribute).
 * The 4 specialized engines' behavioral findings (focus management, widget
 * behavior, interaction prediction, expected focus) require human or AI
 * judgment and are intentionally out of scope here — see them in
 * dashboard.md/comparison.md, or hand merged-report.json to the Copilot
 * Accessibility Fix Agent (.github/agents/accessibility-fix.agent.md), which
 * covers all sources with AI-driven reasoning instead of mechanical rules.
 *
 * Fixes are classified by confidence:
 *
 *   SAFE      -> applied to source (missing alt, aria-label, label,
 *                accessible button/link name, html lang) — but ONLY when
 *                writing is enabled, via `autoFix.applyFixes: true` in
 *                config.json (persistent) or the one-off `--apply` CLI flag
 *                (`npm run auto-fix:apply`). Neither enabled is the default,
 *                in which case SAFE fixes are reported exactly like UNSAFE
 *                ones: specific, actionable, but never written.
 *   UNSAFE    -> suggestion only, never written (colour contrast, heading
 *                order, landmark structure, duplicate ids, role changes, …).
 *
 * A handler may *downgrade* a nominally safe fix to a suggestion when it cannot
 * confidently identify a single source element — this guarantees we never make
 * a blind, potentially-breaking edit. Every decision (applied, suggested, or
 * skipped as a duplicate) is logged and written to reports/fixes.json for
 * auditability.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { adaConfig } from '../playwright/config';
import { createLogger } from './logger';
import { prioritize, countAffectedPages, PRIORITY_RANK, type Priority } from './prioritize';
import { KnowledgeStore } from './knowledge-base';
import type { Summary, SummaryViolation, MergedReport, MergedFinding } from './types';

const log = createLogger('auto-fix');

/**
 * Whether this run is allowed to write fixes to source: the persistent config
 * flag OR the one-off `--apply` CLI flag (`npm run auto-fix:apply`). Resolved
 * once at module load — `process.argv` doesn't change mid-run.
 */
const APPLY_FIXES = adaConfig.autoFix.applyFixes || process.argv.includes('--apply');

/** axe rule ids the harness is allowed to fix automatically (safe, additive). */
const SAFE_RULES = new Set<string>([
  'image-alt',
  'input-image-alt',
  'button-name',
  'input-button-name',
  'link-name',
  'label',
  'select-name',
  'aria-input-field-name',
  'aria-command-name',
  'aria-toggle-field-name',
  'frame-title',
  'html-has-lang',
]);

/** Outcome of attempting to fix one violation. */
interface FixResult {
  ruleId: string;
  page: string;
  url?: string;
  target?: string;
  impact?: string | null;
  priority?: Priority;
  correlation?: string;
  file?: string;
  status: 'applied' | 'suggested' | 'skipped';
  message: string;
}

/**
 * Recursively collect every source file under a directory whose extension is
 * in `adaConfig.autoFix.sourceExtensions` (config-driven so Angular, Vue,
 * plain-HTML, etc. projects aren't silently skipped in favor of only React).
 * @param dir Directory to walk.
 */
function listSourceFiles(dir: string): string[] {
  const extensions = new Set(adaConfig.autoFix.sourceExtensions);
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'build', 'dist', '__tests__', 'tests'].includes(entry.name)) continue;
      out.push(...listSourceFiles(full));
    } else if (extensions.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Extract an attribute value from an HTML snippet, e.g. attr("src", html). */
function attr(name: string, html: string): string | undefined {
  const m = html.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m?.[1];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract id/class tokens from a CSS selector, e.g. axe's `target` (like "button.icon-btn.primary" or "#submit"). */
function selectorTokens(target: string | undefined): string[] {
  if (!target) return [];
  const tokens: string[] = [];
  const idMatch = target.match(/#([\w-]+)/);
  if (idMatch) tokens.push(idMatch[1]);
  for (const m of target.match(/\.([\w-]+)/g) ?? []) tokens.push(m.slice(1));
  return tokens;
}

/** True when a source tag's id or class attribute contains `token` as a whole class/id, not a substring match. */
function tagHasToken(tag: string, token: string): boolean {
  const esc = escapeRegex(token);
  if (new RegExp(`\\bid=["']${esc}["']`).test(tag)) return true;
  if (new RegExp(`\\bclass(Name)?=["'][^"']*\\b${esc}\\b[^"']*["']`).test(tag)) return true;
  return false;
}

/**
 * Narrow a candidate list to the ones whose id/class literally matches a
 * token parsed from axe's CSS selector `target` — this is what actually ties
 * a fix to the SPECIFIC flagged element rather than "there happens to be
 * exactly one tag of this kind missing the attribute somewhere in the file,"
 * which can misfire when a file has multiple same-tag elements (e.g. one
 * already-accessible button via text content, plus the actually-broken one —
 * the attribute-only regex can't see text content, so both would otherwise
 * look like equally-valid candidates). Falls back to the unnarrowed list
 * when the target has no literal id/class to match (e.g. dynamic classNames),
 * preserving the existing conservative "only fix if unambiguous" behavior.
 */
function narrowByTarget(candidates: string[], target: string | undefined): string[] {
  const tokens = selectorTokens(target);
  if (!tokens.length) return candidates;
  const narrowed = candidates.filter((tag) => tokens.some((t) => tagHasToken(tag, t)));
  return narrowed.length > 0 ? narrowed : candidates;
}

/** Convert a filename or slug into human-readable alt/label text. */
function humanize(input: string): string {
  const base = input.split('/').pop() ?? input;
  const noExt = base.replace(/\.[a-z0-9]+$/i, '');
  const words = noExt.replace(/[-_]+/g, ' ').trim();
  return words.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Image';
}

/**
 * Apply a text edit to a file: replace `oldStr` with `newStr` when `oldStr`
 * occurs exactly once. Returns true when the edit was written.
 */
function applyEdit(file: string, oldStr: string, newStr: string): boolean {
  const content = fs.readFileSync(file, 'utf-8');
  const first = content.indexOf(oldStr);
  if (first === -1) return false;
  // Require uniqueness so we never edit the wrong occurrence.
  if (content.indexOf(oldStr, first + oldStr.length) !== -1) return false;

  fs.writeFileSync(file, content.replace(oldStr, newStr), 'utf-8');
  return true;
}

/**
 * Render a source file path relative to the application root (parent of
 * `appSrcDir`), with forward slashes, for portable, machine-independent
 * reports — an absolute filesystem path in fixes.json would embed local
 * machine specifics into an artifact meant to be diffed/shared across CI runs
 * and machines.
 */
function toRelative(file: string): string {
  return path.relative(adaConfig.paths.appSrc, file).split(path.sep).join('/');
}

/**
 * Gate for every SAFE-rule handler: an unambiguous single-candidate fix has
 * been found (`oldStr` -> `newStr` in `file`), described by `appliedMessage`.
 * When `APPLY_FIXES` is off (the default) this reports the fix as a
 * suggestion — identical in specificity to an applied one, just not written —
 * so `npm run auto-fix` never edits source unless explicitly opted in (via
 * config or `npm run auto-fix:apply`).
 * Returns null when applying was requested but the edit could not be written
 * (e.g. `oldStr` no longer unique), letting the caller fall through to the
 * next candidate file or the generic suggestion.
 */
function applyOrSuggest(
  v: SummaryViolation,
  file: string,
  oldStr: string,
  newStr: string,
  appliedMessage: string
): FixResult | null {
  const relFile = toRelative(file);
  if (!APPLY_FIXES) {
    return {
      ruleId: v.ruleId,
      page: v.page,
      file: relFile,
      status: 'suggested',
      message: `${appliedMessage} (not applied — auto-fix is in report-only mode; set autoFix.applyFixes: true in config.json, or run "npm run auto-fix:apply", to enable automatic edits)`,
    };
  }
  if (applyEdit(file, oldStr, newStr)) {
    return { ruleId: v.ruleId, page: v.page, file: relFile, status: 'applied', message: appliedMessage };
  }
  return null;
}

/**
 * Search EVERY candidate file for elements matching `tagRegex` + `matcher`,
 * and return the single match only when there is exactly one across the
 * ENTIRE project — not just the first file examined. Per-file uniqueness
 * alone is not a safety guarantee: two different files can each have exactly
 * one bare, unlabeled element of the same kind (e.g. two components each with
 * one unlabeled `<select>`), and picking whichever file happens to be scanned
 * first can silently "fix" a different, unrelated element than the one axe
 * actually flagged — caught in testing: a generic `select` target (axe gave
 * no id/class to narrow by) matched an unrelated `<select>` in one component
 * before ever reaching the real one in another.
 */
function findUniqueCandidate(
  files: string[],
  tagRegex: RegExp,
  matcher: (tag: string) => boolean,
  target: string | undefined
): { file: string; tag: string } | null {
  const matches: { file: string; tag: string }[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const raw = content.match(tagRegex) ?? [];
    const candidates = narrowByTarget(raw.filter(matcher), target);
    for (const tag of candidates) matches.push({ file, tag });
    if (matches.length > 1) return null; // already ambiguous — no need to keep scanning
  }
  return matches.length === 1 ? matches[0] : null;
}

// ---------------------------------------------------------------------------
// Handlers — each returns a FixResult.
// ---------------------------------------------------------------------------

/**
 * Fix `image-alt`: add a descriptive alt attribute to an <img> missing one.
 */
function fixImageAlt(v: SummaryViolation, files: string[]): FixResult {
  const src = attr('src', v.html);
  const altText = humanize(src ?? 'image');
  const basename = src ? (src.split('/').pop()?.split('?')[0] ?? '') : '';

  const match = findUniqueCandidate(
    files,
    /<img\b[^>]*?\/?>/gi,
    (tag) => !/\balt\s*=/.test(tag) && (!basename || tag.includes(basename)),
    v.target
  );
  if (match) {
    const fixed = match.tag.replace(/\/?>$/, (end) => ` alt="${altText}"${end}`);
    const result = applyOrSuggest(v, match.file, match.tag, fixed, `Added alt="${altText}" to <img>`);
    if (result) return result;
  }
  return suggest(v, `Add a descriptive alt attribute, e.g. alt="${altText}".`);
}

/**
 * Fix `button-name` / `input-button-name` / `aria-*-name`: add an aria-label to
 * a control that has no accessible name. Only applied when a confident label
 * can be derived and a single matching source element exists.
 */
function fixControlName(v: SummaryViolation, files: string[], tagName: string): FixResult {
  // Derive a candidate accessible name from existing attributes. Deliberately
  // NOT from `class`: axe's captured `html` is the live, rendered DOM, whose
  // class list routinely includes framework-injected state classes (e.g.
  // Angular's ng-valid/ng-dirty/ng-untouched on any [(ngModel)] control) that
  // have nothing to do with the element's purpose — humanizing one of those
  // produces a wrong, misleading name (caught in testing: an Angular <select>
  // got aria-label="Ng Valid" from its ng-valid class). name/id are the
  // element's own authored identifiers and don't have this problem.
  const derived =
    attr('title', v.html) ??
    (attr('name', v.html) ? humanize(attr('name', v.html)!) : undefined) ??
    (attr('id', v.html) ? humanize(attr('id', v.html)!) : undefined);

  if (!derived) {
    return suggest(v, `Add an accessible name, e.g. aria-label or visible text on the <${tagName}>.`);
  }

  const match = findUniqueCandidate(
    files,
    new RegExp(`<${tagName}\\b[^>]*?>`, 'gi'),
    (t) => !/\baria-label\s*=/.test(t) && !/\baria-labelledby\s*=/.test(t),
    v.target
  );
  if (match) {
    const fixed = match.tag.replace(/\s*\/?>$/, (end) => ` aria-label="${derived}"${end}`);
    const result = applyOrSuggest(
      v,
      match.file,
      match.tag,
      fixed,
      `Added aria-label="${derived}" to <${tagName}>`
    );
    if (result) return result;
  }
  return suggest(v, `Add aria-label="${derived}" to the <${tagName}>.`);
}

/**
 * Fix `label`: associate a form field with a label by adding an aria-label
 * derived from its placeholder / name / id / type.
 */
function fixLabel(v: SummaryViolation, files: string[]): FixResult {
  const labelText = humanize(
    attr('placeholder', v.html) ??
      attr('name', v.html) ??
      attr('id', v.html) ??
      attr('type', v.html) ??
      'field'
  );
  const id = attr('id', v.html);
  const name = attr('name', v.html);

  const match = findUniqueCandidate(
    files,
    /<input\b[^>]*?\/?>/gi,
    (t) => {
      if (/\baria-label\s*=/.test(t)) return false;
      if (id && t.includes(`id="${id}"`)) return true;
      if (name && t.includes(`name="${name}"`)) return true;
      return false;
    },
    v.target
  );
  if (match) {
    const fixed = match.tag.replace(/\/?>$/, (end) => ` aria-label="${labelText}"${end}`);
    const result = applyOrSuggest(
      v,
      match.file,
      match.tag,
      fixed,
      `Added aria-label="${labelText}" to <input>`
    );
    if (result) return result;
  }
  return suggest(
    v,
    `Associate a <label htmlFor="${id ?? 'field'}"> with the input, or add aria-label="${labelText}".`
  );
}

/**
 * Fix `html-has-lang`: ensure the app's HTML entry point declares a language.
 * Checks each path in `adaConfig.autoFix.htmlEntryPoints` (relative to the
 * application root — the parent of `appSrcDir` — e.g. `public/index.html`
 * for CRA, `src/index.html` for Angular/Vite) and fixes the first one found —
 * config-driven so this isn't tied to a single framework's project layout.
 */
function fixHtmlLang(v: SummaryViolation): FixResult {
  const appRoot = path.join(adaConfig.paths.appSrc, '..');
  for (const entry of adaConfig.autoFix.htmlEntryPoints) {
    const indexHtml = path.join(appRoot, entry);
    if (!fs.existsSync(indexHtml)) continue;
    const content = fs.readFileSync(indexHtml, 'utf-8');
    if (/<html\b(?![^>]*\blang=)[^>]*>/i.test(content)) {
      if (!APPLY_FIXES) {
        return {
          ruleId: v.ruleId,
          page: v.page,
          file: toRelative(indexHtml),
          status: 'suggested',
          message:
            'Add lang="en" to <html> (not applied — auto-fix is in report-only mode; set autoFix.applyFixes: true in config.json, or run "npm run auto-fix:apply", to enable automatic edits)',
        };
      }
      const fixed = content.replace(/<html\b/i, '<html lang="en"');
      fs.writeFileSync(indexHtml, fixed, 'utf-8');
      return {
        ruleId: v.ruleId,
        page: v.page,
        file: toRelative(indexHtml),
        status: 'applied',
        message: 'Added lang="en" to <html>',
      };
    }
    break; // found the entry point but it already has a lang attribute
  }
  return suggest(
    v,
    `Add lang="en" to the <html> element (checked: ${adaConfig.autoFix.htmlEntryPoints.join(', ')}).`
  );
}

/** Build a suggestion-only result. */
function suggest(v: SummaryViolation, message: string): FixResult {
  return { ruleId: v.ruleId, page: v.page, status: 'suggested', message };
}

/**
 * Fix `frame-title`: add a descriptive title to an <iframe> that lacks one.
 */
function fixFrameTitle(v: SummaryViolation, files: string[]): FixResult {
  const title = humanize(attr('src', v.html) ?? attr('name', v.html) ?? 'embedded content');
  const match = findUniqueCandidate(files, /<iframe\b[^>]*?>/gi, (t) => !/\btitle\s*=/.test(t), v.target);
  if (match) {
    const fixed = match.tag.replace(/\s*\/?>$/, (end) => ` title="${title}"${end}`);
    const result = applyOrSuggest(v, match.file, match.tag, fixed, `Added title="${title}" to <iframe>`);
    if (result) return result;
  }
  return suggest(v, `Add title="${title}" to the <iframe>.`);
}

/**
 * Fix `input-image-alt`: add alt text to an <input type="image"> without one.
 */
function fixInputImageAlt(v: SummaryViolation, files: string[]): FixResult {
  const altText = humanize(attr('src', v.html) ?? attr('name', v.html) ?? 'submit');
  const match = findUniqueCandidate(
    files,
    /<input\b[^>]*?\/?>/gi,
    (t) => /type=["']image["']/i.test(t) && !/\balt\s*=/.test(t),
    v.target
  );
  if (match) {
    const fixed = match.tag.replace(/\/?>$/, (end) => ` alt="${altText}"${end}`);
    const result = applyOrSuggest(
      v,
      match.file,
      match.tag,
      fixed,
      `Added alt="${altText}" to <input type="image">`
    );
    if (result) return result;
  }
  return suggest(v, `Add alt="${altText}" to the <input type="image">.`);
}

/**
 * Load the violations the agent must act on. Prefers the correlated
 * merged-report.json (findings verified across axe-core, the Playwright
 * accessibility tree, and Windows UI Automation); falls back to summary.json
 * when the merged report is unavailable.
 */
function loadViolations(): { violations: SummaryViolation[]; source: string } {
  if (fs.existsSync(adaConfig.paths.merged)) {
    const merged: MergedReport = JSON.parse(fs.readFileSync(adaConfig.paths.merged, 'utf-8'));
    // MergedFinding extends SummaryViolation, so it is safe to consume directly.
    return { violations: merged.findings, source: 'merged-report.json' };
  }
  if (fs.existsSync(adaConfig.paths.summary)) {
    const summary: Summary = JSON.parse(fs.readFileSync(adaConfig.paths.summary, 'utf-8'));
    return { violations: summary.violations, source: 'summary.json' };
  }
  throw new Error('Neither merged-report.json nor summary.json found. Run "npm run ada" first.');
}

/** Extract the tag name from an outerHTML snippet, e.g. "<div role=\"button\">" -> "div". */
function tagNameFromHtml(html: string): string | undefined {
  return html.match(/^<\s*([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase();
}

/**
 * Route a violation to the correct handler based on its rule id.
 */
function handleViolation(v: SummaryViolation, files: string[]): FixResult {
  if (!SAFE_RULES.has(v.ruleId)) {
    return suggest(v, `Unsafe/complex rule "${v.ruleId}" — manual review required. See ${v.helpUrl}`);
  }

  switch (v.ruleId) {
    case 'image-alt':
      return fixImageAlt(v, files);
    case 'input-image-alt':
      return fixInputImageAlt(v, files);
    case 'button-name':
      return fixControlName(v, files, 'button');
    case 'input-button-name':
      return fixControlName(v, files, 'input');
    case 'link-name':
      return fixControlName(v, files, 'a');
    case 'select-name':
      return fixControlName(v, files, 'select');
    case 'aria-command-name':
    case 'aria-toggle-field-name':
      // These rules apply to ANY element carrying the relevant ARIA role
      // (button/link/menuitem/checkbox/switch), not just literal <button>
      // tags — a <div role="button"> is just as valid. Use the real tag from
      // the violation's own HTML so custom-role elements aren't silently
      // uncoverable; fall back to 'button' only if extraction fails.
      return fixControlName(v, files, tagNameFromHtml(v.html) ?? 'button');
    case 'label':
    case 'aria-input-field-name':
      return fixLabel(v, files);
    case 'frame-title':
      return fixFrameTitle(v, files);
    case 'html-has-lang':
      return fixHtmlLang(v);
    default:
      return suggest(v, `No handler implemented for "${v.ruleId}".`);
  }
}

/** Generic, project-independent strategy label for the knowledge base. */
function strategyFor(ruleId: string): string {
  const map: Record<string, string> = {
    'image-alt': 'add-attribute:alt',
    'input-image-alt': 'add-attribute:alt',
    'button-name': 'add-attribute:aria-label',
    'input-button-name': 'add-attribute:aria-label',
    'link-name': 'add-attribute:aria-label',
    'select-name': 'add-attribute:aria-label',
    'aria-input-field-name': 'add-attribute:aria-label',
    'aria-command-name': 'add-attribute:aria-label',
    'aria-toggle-field-name': 'add-attribute:aria-label',
    label: 'add-attribute:aria-label',
    'frame-title': 'add-attribute:title',
    'html-has-lang': 'add-attribute:lang',
  };
  return map[ruleId] ?? 'manual-review';
}

/**
 * Render a human-readable Markdown fix report (fixes.md) grouped by priority.
 */
function writeFixesMarkdown(results: FixResult[], source: string): void {
  const applied = results.filter((r) => r.status === 'applied');
  const suggested = results.filter((r) => r.status === 'suggested');
  const skipped = results.filter((r) => r.status === 'skipped');
  const order: Priority[] = ['critical', 'high', 'medium', 'low'];

  const lines: string[] = [
    '# Accessibility Fix Report',
    '',
    `_Generated: ${new Date().toISOString()}_`,
    `_Source: ${source}_`,
    `_Mode: ${APPLY_FIXES ? 'auto-apply safe fixes' : 'report-only (no source files were modified)'}_`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '| --- | --- |',
    `| Applied (safe) | ${applied.length} |`,
    `| Suggested (needs review) | ${suggested.length} |`,
    `| Skipped (duplicate of another finding) | ${skipped.length} |`,
    '',
    '## Applied Fixes (by priority)',
    '',
  ];

  const row = (r: FixResult) =>
    `- **[${(r.priority ?? 'low').toUpperCase()}]** \`${r.ruleId}\` on **${r.page}** ` +
    `\`${r.target ?? ''}\` — ${r.message}${r.file ? ` (\`${r.file}\`)` : ''}`;

  for (const p of order) {
    const group = applied.filter((r) => (r.priority ?? 'low') === p);
    if (group.length) {
      lines.push(`### ${p.toUpperCase()} (${group.length})`, '', ...group.map(row), '');
    }
  }
  if (!applied.length) lines.push('_No safe fixes were applied._', '');

  lines.push('## Suggested (manual review required)', '');
  if (suggested.length) {
    for (const p of order) {
      const group = suggested.filter((r) => (r.priority ?? 'low') === p);
      if (group.length) lines.push(`### ${p.toUpperCase()} (${group.length})`, '', ...group.map(row), '');
    }
  } else {
    lines.push('_None._', '');
  }

  fs.writeFileSync(adaConfig.paths.fixesMd, lines.join('\n'), 'utf-8');
  log.info(`Fix report -> ${path.relative(process.cwd(), adaConfig.paths.fixesMd)}`);
}

/**
 * Entry point: read the merged report, prioritize, apply safe fixes, update the
 * knowledge base, and write reports/fixes.json + reports/fixes.md.
 */
function main(): void {
  try {
    const { violations, source } = loadViolations();
    const files = listSourceFiles(adaConfig.paths.appSrc);
    log.info(
      `Loaded ${violations.length} violation(s) from ${source}; scanning ${files.length} source file(s).`
    );

    // Phase 2 context: how many pages each rule affects (reach signal).
    const affected = countAffectedPages(violations as MergedFinding[]);
    // Continuous learning: load the project-independent knowledge base.
    const kb = new KnowledgeStore(adaConfig.paths.knowledgeBase);

    const results: FixResult[] = [];
    // De-duplicate identical (rule, target) pairs so we don't re-edit.
    const seen = new Set<string>();

    for (const v of violations) {
      const key = `${v.ruleId}::${v.target}`;
      if (seen.has(key)) {
        // Same rule + element already processed (reported redundantly by
        // multiple correlated sources) — recorded, not silently dropped, so
        // every input violation is accounted for in fixes.json.
        results.push({
          ruleId: v.ruleId,
          page: v.page,
          url: v.url,
          target: v.target,
          impact: v.impact,
          status: 'skipped',
          message: 'Duplicate of an already-processed finding for the same rule and element.',
        });
        continue;
      }
      seen.add(key);

      // Phase 2: compute remediation priority (impact + reach + confirmations).
      const mf = v as MergedFinding;
      const priority = mf.verifiedIn
        ? prioritize(mf, { affectedPages: affected.get(v.ruleId) ?? 1 })
        : ((v.impact === 'critical'
            ? 'critical'
            : v.impact === 'serious'
              ? 'high'
              : v.impact === 'moderate'
                ? 'medium'
                : 'low') as Priority);

      // Continuous learning: note when we are reusing a known pattern.
      const known = kb.recall(v.ruleId);
      if (known)
        log.debug(`Reusing known pattern for ${v.ruleId} (${known.strategy}, used ${known.timesApplied}x)`);

      const result = handleViolation(v, files);
      result.priority = priority;
      result.impact = v.impact;
      result.url = v.url;
      result.target = v.target;
      result.correlation = mf.correlation;
      results.push(result);

      // Record successful, generic patterns back to the knowledge base.
      if (result.status === 'applied') kb.record(v.ruleId, strategyFor(v.ruleId));

      const label = `[${priority.toUpperCase()}] ${result.status.toUpperCase()} [${result.ruleId}] ${result.message}`;
      if (result.status === 'applied') log.info(label, result.file);
      else if (result.status === 'suggested') log.warn(label);
      else log.debug(label);
    }

    // Sort by priority (critical first), then applied before suggested.
    results.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority ?? 'low'] - PRIORITY_RANK[b.priority ?? 'low'] ||
        (a.status === b.status ? 0 : a.status === 'applied' ? -1 : 1)
    );

    const applied = results.filter((r) => r.status === 'applied').length;
    const suggested = results.filter((r) => r.status === 'suggested').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    fs.writeFileSync(
      adaConfig.paths.fixes,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source,
          mode: APPLY_FIXES ? 'apply' : 'report-only',
          applied,
          suggested,
          skipped,
          results,
        },
        null,
        2
      ),
      'utf-8'
    );
    writeFixesMarkdown(results, source);
    kb.save();

    log.info(
      `Auto-fix complete (${APPLY_FIXES ? 'apply' : 'report-only'}): ${applied} applied, ${suggested} suggested, ${skipped} skipped (duplicate).`
    );
    log.info(`Fix log -> ${path.relative(process.cwd(), adaConfig.paths.fixes)}`);
  } catch (err) {
    log.error('Auto-fix failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
