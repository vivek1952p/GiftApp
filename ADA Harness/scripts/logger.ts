/**
 * ============================================================================
 * ADA Harness — Logger
 * ============================================================================
 *
 * A tiny, dependency-free structured logger. Every module logs through this so
 * output is consistent, timestamped, and level-tagged. Levels can be filtered
 * with the ADA_LOG_LEVEL environment variable (debug|info|warn|error).
 * ============================================================================
 */

/** Supported log levels ordered by verbosity. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Minimum level to emit; anything below is suppressed. */
const MIN_LEVEL: Level = (process.env.ADA_LOG_LEVEL as Level) ?? 'info';

/**
 * Emit a single log line if it meets the configured minimum level.
 * @param level  Severity of the message.
 * @param scope  Short module name shown in brackets.
 * @param msg    The message to log.
 * @param extra  Optional structured payload appended as JSON.
 */
function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const ts = new Date().toISOString();
  const tag = `[${ts}] [${level.toUpperCase()}] [${scope}]`;
  const line = `${tag} ${msg}`;

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra !== undefined) {
    sink(line, typeof extra === 'string' ? extra : JSON.stringify(extra));
  } else {
    sink(line);
  }
}

/**
 * Create a scoped logger bound to a module name.
 * @param scope Module name (e.g. "scan", "auto-fix").
 */
export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit('debug', scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit('error', scope, msg, extra),
  };
}
