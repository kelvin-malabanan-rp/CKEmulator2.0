import type { LogEntry } from './useEmulator';

/**
 * Wire-log line categories used by the log filter chips and colour coding.
 * `wire` is real protocol traffic (vj/pole/scanner channels); the rest are
 * classified from the `sys` line text.
 */
export type LogCategory = 'connection' | 'data' | 'error' | 'wire';

/**
 * Categorise a log line. Protocol channels are always `wire`; `sys` lines are
 * classified by text with error taking precedence (so "Ads error: …" is an
 * error, not a data load), then connection events, then data/config loads as
 * the default.
 */
export function categorizeLog(channel: LogEntry['channel'], text: string): LogCategory {
  if (channel !== 'sys') return 'wire';
  if (/error|fail|failed|✗|✘/i.test(text)) return 'error';
  if (/connect|disconnect|registering|registered|register/i.test(text)) return 'connection';
  return 'data';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Compact relative timestamp with second-level granularity so burst-loaded
 * lines stay distinguishable ("now" / "12s ago" / "10m02s ago" / "2h05m ago")
 * — five lines logged seconds apart no longer collapse to a single "10m ago".
 * Pure over both times so it is unit-testable without a clock; the component
 * feeds a ticking `nowMs`. Negative deltas (clock skew) clamp to 0 → "now".
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (sec < 5) return 'now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${pad2(sec % 60)}s ago`;
  const hr = Math.floor(sec / 3600);
  return `${hr}h${pad2(Math.floor((sec % 3600) / 60))}m ago`;
}
