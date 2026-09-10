'use strict';

// Client for the local UI daemon (`sfdata --ui`). When the generator is served by the
// daemon it is same-origin with these endpoints; when opened as a file:// document there
// is no daemon and execution is disabled.

const SESSION_KEY = 'sfdata.execute.session.v1';
const RESULT_MARKER = '__SFDATA_RESULT__';

/** True when the page is served over http(s) (i.e. potentially by the daemon). */
export function daemonPossible() {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

/** Pings /status. Resolves with the daemon info, or null when unreachable. */
export async function checkDaemon() {
  if (!daemonPossible()) return null;
  try {
    const response = await fetch('/status', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Fetches the local auth environment (.env presence, sf orgs, recommended source). */
export async function fetchAuth() {
  const response = await fetch('/auth', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Auth check failed (${response.status})`);
  return response.json();
}

/** Fetches any conf.yaml / scripts.js present in the daemon's folder. */
export async function fetchConfig() {
  const response = await fetch('/config', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Config check failed (${response.status})`);
  return response.json();
}

/**
 * Persists conf.yaml (and scripts.js) to the daemon's folder without running the pipeline.
 * @param payload { yaml, script?, hasTransform }
 */
export async function saveConfig(payload) {
  const response = await fetch('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = `Save failed (${response.status})`;
    try {
      message = (await response.json()).error || message;
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }
  return response.json();
}

/** Session-scoped credential store (sessionStorage): pasted token + instance URL. */
export function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSession(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Starts a run and streams the daemon's output.
 * @param payload  { yaml, script?, hasTransform, auth, fromTask?, toTask? }
 * @param handlers { onLine(text), onResult({exitCode,status,outputs}) }
 * @returns the parsed result object, or throws on transport / pre-run failure.
 */
export async function runPipeline(payload, handlers = {}) {
  const response = await fetch('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Pre-run failures (busy, bad auth, write error) return JSON, not a stream.
  const contentType = response.headers.get('Content-Type') || '';
  if (!response.ok || contentType.includes('application/json')) {
    let message = `Run failed (${response.status})`;
    let needsToken = false;
    try {
      const error = await response.json();
      message = error.error || message;
      needsToken = Boolean(error.needsToken);
    } catch {
      /* keep default message */
    }
    const error = new Error(message);
    error.needsToken = needsToken;
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let result = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop();
    for (const line of lines) {
      const parsed = handleLine(line, handlers);
      if (parsed) result = parsed;
    }
  }
  if (carry) {
    const parsed = handleLine(carry, handlers);
    if (parsed) result = parsed;
  }
  return result;
}

function handleLine(line, handlers) {
  if (line.startsWith(RESULT_MARKER)) {
    try {
      const result = JSON.parse(line.slice(RESULT_MARKER.length).trim());
      handlers.onResult?.(result);
      return result;
    } catch {
      return null;
    }
  }
  handlers.onLine?.(line);
  return null;
}
