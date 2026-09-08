import { DataSheet } from '../model/DataSheet';

export type WriteOperation = 'insert' | 'update' | 'upsert' | 'delete';

export interface PreparedWriteRow {
  inputIndex: number;
  // Empty CSV cells are stored as null so the JSON REST API omits them or sends
  // an explicit null, instead of sending "" which Salesforce rejects for typed
  // fields such as date/datetime ("Cannot deserialize instance of date from
  // VALUE_STRING value"). The CSV-based Bulk path coerces null back to "".
  values: Record<string, string | null>;
}

export interface SalesforceWriteRequest {
  operation: WriteOperation;
  object: string;
  fields: string[];
  externalIdField?: string;
  rows: PreparedWriteRow[];
}

export interface WriteRowResult {
  inputIndex: number;
  success: boolean;
  id?: string;
  error?: string;
}

export interface SalesforceDataLoader {
  query(instanceUrl: string, accessToken: string, query: string, outputName: string): Promise<DataSheet>;
  write(instanceUrl: string, accessToken: string, request: SalesforceWriteRequest): Promise<WriteRowResult[]>;
}

const STATUS_HEARTBEAT_MS = 10_000;

export function logSalesforceStatus(message: string): void {
  console.log(message);
}

export async function withStatusHeartbeat<T>(
  work: PromiseLike<T>,
  onTick: (elapsedMs: number) => void,
  intervalMs = STATUS_HEARTBEAT_MS
): Promise<T> {
  const started = Date.now();
  const timer = setInterval(() => onTick(Date.now() - started), intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}

export function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function deriveSoqlHeaders(query: string): string[] {
  const match = query.match(/^\s*select\s+([\s\S]+?)\s+from\s+/i);
  if (!match) {
    return [];
  }
  return splitSelectList(match[1]).map(expression => {
    const alias = expression.match(/\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (alias && /[()]/.test(expression)) {
      return alias[1];
    }
    return expression.trim();
  });
}

function splitSelectList(selectList: string): string[] {
  const expressions: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectList.length; index++) {
    if (selectList[index] === '(') depth++;
    if (selectList[index] === ')') depth--;
    if (selectList[index] === ',' && depth === 0) {
      expressions.push(selectList.slice(start, index).trim());
      start = index + 1;
    }
  }
  expressions.push(selectList.slice(start).trim());
  return expressions.filter(Boolean);
}
