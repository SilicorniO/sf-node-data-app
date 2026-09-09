// Auto mode decides, per action, whether to use the synchronous API or the Bulk
// API v2 based on the record count involved. It holds only pure decision logic:
// the caller (ActionProcessor) is responsible for obtaining the count and for
// running the chosen loader. Keeping this dependency-light (no axios, no models)
// makes the decision rules easy to read and test in isolation.

export type AutoMethod = 'api' | 'bulk';

export interface AutoDecision {
  method: AutoMethod;
  /** Human-readable explanation, e.g. "45000 records >= 10000 -> Bulk API v2". */
  reason: string;
}

// -------------------------------------------------------------------------
// Method selection
// -------------------------------------------------------------------------

/**
 * Core rule: below the threshold use the synchronous API (lower latency, no job
 * lifecycle); at or above it use Bulk API v2 (better throughput at volume).
 */
export function decideByCount(count: number, threshold: number): AutoDecision {
  if (count >= threshold) {
    return {
      method: 'bulk',
      reason: `${count} records >= ${threshold} -> Bulk API v2`,
    };
  }
  return {
    method: 'api',
    reason: `${count} records < ${threshold} -> synchronous API`,
  };
}

// -------------------------------------------------------------------------
// COUNT() rewrite for GET actions
// -------------------------------------------------------------------------

// GET actions have no known count before running, so auto mode issues a cheap
// COUNT() query first. Only a simple "SELECT <list> FROM <object> [WHERE ...]"
// shape is safely rewritable; anything with aggregation, grouping, or a row cap
// would make COUNT() meaningless or invalid, so we bail out and let the caller
// fall back to the synchronous API.
const UNSUPPORTED_CLAUSE = /\b(group\s+by|limit|offset)\b/i;
const AGGREGATE_FUNCTION = /\b(count|count_distinct|sum|avg|min|max)\s*\(/i;

/**
 * Rewrite a simple SOQL SELECT into "SELECT COUNT() FROM <object> [WHERE ...]".
 * Returns null when the query is not safely rewritable (aggregates, GROUP BY,
 * LIMIT/OFFSET, or an unrecognized shape).
 */
export function buildCountQuery(soql: string): string | null {
  const trimmed = soql.trim();

  // Reject queries whose result count would differ from a plain COUNT(), or
  // where COUNT() is not valid (aggregate queries already return groups).
  if (UNSUPPORTED_CLAUSE.test(trimmed) || AGGREGATE_FUNCTION.test(trimmed)) {
    return null;
  }

  // Capture the object and any trailing clauses (WHERE, ORDER BY, etc.). ORDER BY
  // is harmless for COUNT() but pointless, so we drop everything after the object
  // except WHERE, which changes the count and must be preserved.
  const match = trimmed.match(/^\s*select\s+[\s\S]+?\s+from\s+([A-Za-z0-9_]+)\b([\s\S]*)$/i);
  if (!match) {
    return null;
  }

  const object = match[1];
  const remainder = match[2];
  const whereMatch = remainder.match(/\bwhere\b[\s\S]*?(?=\border\s+by\b|\bwith\b|\bfor\b|$)/i);
  const whereClause = whereMatch ? ` ${whereMatch[0].trim()}` : '';

  return `SELECT COUNT() FROM ${object}${whereClause}`;
}
