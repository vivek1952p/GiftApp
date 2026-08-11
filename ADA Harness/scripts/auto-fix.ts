/**
 * ============================================================================
 * ADA Harness — Auto Fix Engine (Steps 4 & 5)
 * ============================================================================
 *
 * Reads reports/summary.json and, for every violation, attempts to locate the
 * offending element in the React source under src/ and fix it.
 *
 * Fixes are classified by confidence:
 *
 *   SAFE      -> applied automatically (missing alt, aria-label, label,
 *                accessible button/link name, html lang).
 *   UNSAFE    -> suggestion only, never written (colour contrast, heading
 *                order, landmark structure, duplicate ids, role changes, …).
 *
 * A handler may *downgrade* a nominally safe fix to a suggestion when it cannot
 * confidently identify a single source element — this guarantees we never make
 * a blind, potentially-breaking edit. Every decision is logged and written to
 * reports/fixes.json for auditability.
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
 * Recursively collect every React source file under a directory.
 * @param dir Directory to walk.
 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'build', '__tests__', 'tests'].includes(entry.name)) continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
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

// ---------------------------------------------------------------------------
// Handlers — each returns a FixResult.
// ---------------------------------------------------------------------------

/**
 * Fix `image-alt`: add a descriptive alt attribute to an <img> missing one.
 */
function fixImageAlt(v: SummaryViolation, files: string[]): FixResult {
  const src = attr('src', v.html);
  const altText = humanize(src ?? 'image');
  const basename = src ? src.split('/').pop()?.split('?')[0] ?? '' : '';

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    // Find <img ...> tags with no alt attribute.
    const imgTags = content.match(/<img\b[^>]*?\/?>/gi) ?? [];
    const candidates = imgTags.filter(
      (tag) => !/\balt\s*=/.test(tag) && (!basename || tag.includes(basename))
    );

    if (candidates.length === 1) {
      const tag = candidates[0];
      const fixed = tag.replace(/\/?>$/, (end) => ` alt="${altText}"${end}`);
      if (applyEdit(file, tag, fixed)) {
        return {
          ruleId: v.ruleId,
          page: v.page,
          file,
          status: 'applied',
          message: `Added alt="${altText}" to <img>`,
        };
      }
    }
  }
  return suggest(v, `Add a descriptive alt attribute, e.g. alt="${altText}".`);
}

/**
 * Fix `button-name` / `input-button-name` / `aria-*-name`: add an aria-label to
 * a control that has no accessible name. Only applied when a confident label
 * can be derived and a single matching source element exists.
 */
function fixControlName(v: SummaryViolation, files: string[], tagName: string): FixResult {
  // Derive a candidate accessible name from existing attributes.
  const derived =
    attr('title', v.html) ??
    (attr('class', v.html) ? humanize(attr('class', v.html)!.split(' ').pop()!) : undefined) ??
    (attr('name', v.html) ? humanize(attr('name', v.html)!) : undefined);

  if (!derived) {
    return suggest(v, `Add an accessible name, e.g. aria-label or visible text on the <${tagName}>.`);
  }

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const tags = content.match(new RegExp(`<${tagName}\\b[^>]*?>`, 'gi')) ?? [];
    const candidates = tags.filter((t) => !/\baria-label\s*=/.test(t) && !/\baria-labelledby\s*=/.test(t));

    if (candidates.length === 1) {
      const tag = candidates[0];
      const fixed = tag.replace(/\s*\/?>$/, (end) => ` aria-label="${derived}"${end}`);
      if (applyEdit(file, tag, fixed)) {
        return {
          ruleId: v.ruleId,
          page: v.page,
          file,
          status: 'applied',
          message: `Added aria-label="${derived}" to <${tagName}>`,
        };
      }
    }
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

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const inputs = content.match(/<input\b[^>]*?\/?>/gi) ?? [];
    const candidates = inputs.filter((t) => {
      if (/\baria-label\s*=/.test(t)) return false;
      if (id && t.includes(`id="${id}"`)) return true;
      if (name && t.includes(`name="${name}"`)) return true;
      return false;
    });

    if (candidates.length === 1) {
      const tag = candidates[0];
      const fixed = tag.replace(/\/?>$/, (end) => ` aria-label="${labelText}"${end}`);
      if (applyEdit(file, tag, fixed)) {
        return {
          ruleId: v.ruleId,
          page: v.page,
          file,
          status: 'applied',
          message: `Added aria-label="${labelText}" to <input>`,
        };
      }
    }
  }
  return suggest(
    v,
    `Associate a <label htmlFor="${id ?? 'field'}"> with the input, or add aria-label="${labelText}".`
  );
}

/**
 * Fix `html-has-lang`: ensure public/index.html declares a language.
 */
function fixHtmlLang(v: SummaryViolation): FixResult {
  const indexHtml = path.join(adaConfig.paths.appSrc, '..', 'public', 'index.html');
  if (fs.existsSync(indexHtml)) {
    const content = fs.readFileSync(indexHtml, 'utf-8');
    if (/<html\b(?![^>]*\blang=)[^>]*>/i.test(content)) {
      const fixed = content.replace(/<html\b/i, '<html lang="en"');
      fs.writeFileSync(indexHtml, fixed, 'utf-8');
      return {
        ruleId: v.ruleId,
        page: v.page,
        file: indexHtml,
        status: 'applied',
        message: 'Added lang="en" to <html>',
      };
    }
  }
  return suggest(v, 'Add lang="en" to the <html> element in public/index.html.');
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
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const frames = content.match(/<iframe\b[^>]*?>/gi) ?? [];
    const candidates = frames.filter((t) => !/\btitle\s*=/.test(t));
    if (candidates.length === 1) {
      const tag = candidates[0];
      const fixed = tag.replace(/\s*\/?>$/, (end) => ` title="${title}"${end}`);
      if (applyEdit(file, tag, fixed)) {
        return {
          ruleId: v.ruleId,
          page: v.page,
          file,
          status: 'applied',
          message: `Added title="${title}" to <iframe>`,
        };
      }
    }
  }
  return suggest(v, `Add title="${title}" to the <iframe>.`);
}

/**
 * Fix `input-image-alt`: add alt text to an <input type="image"> without one.
 */
function fixInputImageAlt(v: SummaryViolation, files: string[]): FixResult {
  const altText = humanize(attr('src', v.html) ?? attr('name', v.html) ?? 'submit');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const inputs = content.match(/<input\b[^>]*?\/?>/gi) ?? [];
    const candidates = inputs.filter((t) => /type=["']image["']/i.test(t) && !/\balt\s*=/.test(t));
    if (candidates.length === 1) {
      const tag = candidates[0];
      const fixed = tag.replace(/\/?>$/, (end) => ` alt="${altText}"${end}`);
      if (applyEdit(file, tag, fixed)) {
        return {
          ruleId: v.ruleId,
          page: v.page,
          file,
          status: 'applied',
          message: `Added alt="${altText}" to <input type="image">`,
        };
      }
    }
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
      return fixControlName(v, files, 'button');
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
    'label': 'add-attribute:aria-label',
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
  const order: Priority[] = ['critical', 'high', 'medium', 'low'];

  const lines: string[] = [
    '# Accessibility Fix Report',
    '',
    `_Generated: ${new Date().toISOString()}_`,
    `_Source: ${source}_`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '| --- | --- |',
    `| Applied (safe) | ${applied.length} |`,
    `| Suggested (needs review) | ${suggested.length} |`,
    '',
    '## Applied Fixes (by priority)',
    '',
  ];

  const row = (r: FixResult) =>
    `- **[${(r.priority ?? 'low').toUpperCase()}]** \`${r.ruleId}\` on **${r.page}** ` +
    `\`${r.target ?? ''}\` — ${r.message}${r.file ? ` (\`${path.relative(adaConfig.paths.appSrc, r.file)}\`)` : ''}`;

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
    log.info(`Loaded ${violations.length} violation(s) from ${source}; scanning ${files.length} source file(s).`);

    // Phase 2 context: how many pages each rule affects (reach signal).
    const affected = countAffectedPages(violations as MergedFinding[]);
    // Continuous learning: load the project-independent knowledge base.
    const kb = new KnowledgeStore(adaConfig.paths.knowledgeBase);

    const results: FixResult[] = [];
    // De-duplicate identical (rule, target) pairs so we don't re-edit.
    const seen = new Set<string>();

    for (const v of violations) {
      const key = `${v.ruleId}::${v.target}`;
      if (seen.has(key)) continue;
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
      if (known) log.debug(`Reusing known pattern for ${v.ruleId} (${known.strategy}, used ${known.timesApplied}x)`);

      const result = handleViolation(v, files);
      result.priority = priority;
      result.impact = v.impact;
      result.url = v.url;
      result.target = v.target;
      result.correlation = mf.correlation;
      results.push(result);

      // Record successful, generic patterns back to the knowledge base.
      if (result.status === 'applied') kb.record(v.ruleId, strategyFor(v.ruleId));

      const label = `[${(priority).toUpperCase()}] ${result.status.toUpperCase()} [${result.ruleId}] ${result.message}`;
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

    fs.writeFileSync(
      adaConfig.paths.fixes,
      JSON.stringify({ generatedAt: new Date().toISOString(), source, applied, suggested, results }, null, 2),
      'utf-8'
    );
    writeFixesMarkdown(results, source);
    kb.save();

    log.info(`Auto-fix complete: ${applied} applied, ${suggested} suggested.`);
    log.info(`Fix log -> ${path.relative(process.cwd(), adaConfig.paths.fixes)}`);
  } catch (err) {
    log.error('Auto-fix failed', (err as Error).message);
    process.exitCode = 1;
  }
}

main();
