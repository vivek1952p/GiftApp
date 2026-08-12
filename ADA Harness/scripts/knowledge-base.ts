/**
 * ============================================================================
 * ADA Harness — Continuous-Learning Knowledge Base
 * ============================================================================
 *
 * A small, PROJECT-INDEPENDENT store of accessibility remediation patterns. It
 * remembers, per axe rule id, the generic fix strategy that succeeded and how
 * often it has been applied. It intentionally stores NO project-specific data
 * (no routes, selectors, component names, or file paths) so it can be reused
 * across any codebase and improve remediation quality over time.
 *
 * Shape (agent/knowledge-base.json):
 * {
 *   "version": 1,
 *   "entries": {
 *     "image-alt": { "ruleId": "image-alt", "strategy": "add-attribute:alt",
 *                    "timesApplied": 12, "lastApplied": "..." }
 *   }
 * }
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('kb');

/** A single, generic remediation pattern. */
export interface KnowledgeEntry {
  /** axe rule id the pattern applies to. */
  ruleId: string;
  /** Generic strategy label, e.g. "add-attribute:aria-label" (no project data). */
  strategy: string;
  /** How many times this pattern has been successfully applied. */
  timesApplied: number;
  /** ISO timestamp of the most recent application. */
  lastApplied: string;
}

/** Full knowledge-base document. */
export interface KnowledgeBase {
  version: number;
  entries: Record<string, KnowledgeEntry>;
}

/** In-memory knowledge base bound to a file on disk. */
export class KnowledgeStore {
  private kb: KnowledgeBase;

  constructor(private readonly file: string) {
    this.kb = this.load();
  }

  /** Load the KB from disk, tolerating a missing/corrupt file. */
  private load(): KnowledgeBase {
    try {
      if (fs.existsSync(this.file)) {
        return JSON.parse(fs.readFileSync(this.file, 'utf-8')) as KnowledgeBase;
      }
    } catch (err) {
      log.warn(`Could not read knowledge base; starting fresh: ${(err as Error).message}`);
    }
    return { version: 1, entries: {} };
  }

  /** Look up a previously-successful strategy for a rule, if any. */
  recall(ruleId: string): KnowledgeEntry | undefined {
    return this.kb.entries[ruleId];
  }

  /**
   * Record a successful fix, incrementing its usage counter. Only generic,
   * project-independent data is stored.
   */
  record(ruleId: string, strategy: string): void {
    const existing = this.kb.entries[ruleId];
    this.kb.entries[ruleId] = {
      ruleId,
      strategy,
      timesApplied: (existing?.timesApplied ?? 0) + 1,
      lastApplied: new Date().toISOString(),
    };
  }

  /** Persist the KB to disk. */
  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.kb, null, 2), 'utf-8');
      log.info(
        `Knowledge base saved (${Object.keys(this.kb.entries).length} pattern(s)) -> ${path.relative(process.cwd(), this.file)}`
      );
    } catch (err) {
      log.error('Failed to save knowledge base', (err as Error).message);
    }
  }
}
