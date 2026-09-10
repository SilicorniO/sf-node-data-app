import { dump, load } from 'js-yaml';
import { validateConfiguration } from './validation.js';

export function buildConfiguration(state) {
  const app = state.appConfiguration;
  const appConfiguration = {
    processingType: app.processingType || 'api',
    apiVersion: (app.apiVersion || '58.0').trim(),
  };
  const maxWait = optionalPositiveNumber(app.bulkApiMaxWaitSec);
  const poll = optionalPositiveNumber(app.bulkApiPollIntervalSec);
  const queryBatchSize = optionalPositiveNumber(app.queryApiBatchSize);
  if (maxWait !== null) appConfiguration.bulkApiMaxWaitSec = maxWait;
  if (poll !== null) appConfiguration.bulkApiPollIntervalSec = poll;
  if (queryBatchSize !== null && queryBatchSize !== 2000) {
    appConfiguration.queryApiBatchSize = queryBatchSize;
  }
  // Only meaningful in auto mode; emit it when set and not the runtime default (10000).
  const autoBulkThreshold = optionalPositiveNumber(app.autoBulkThreshold);
  if (appConfiguration.processingType === 'auto' && autoBulkThreshold !== null && autoBulkThreshold !== 10000) {
    appConfiguration.autoBulkThreshold = autoBulkThreshold;
  }
  if (app.cleanOutputFolderBeforeExecution) appConfiguration.cleanOutputFolderBeforeExecution = true;
  if (app.deleteErrorFilesBeforeExecution) appConfiguration.deleteErrorFilesBeforeExecution = true;

  const sheets = state.sheets.map(sheet => {
    const result = { name: sheet.name.trim() };
    const fields = sheet.fields
      .filter(field => field.translate)
      .map(field => ({ name: field.name.trim(), apiName: field.apiName.trim() }));
    if (fields.length) result.fields = fields;
    return result;
  });

  const actions = state.actions.map(buildActionConfiguration);
  const configuration = { appConfiguration };
  if (sheets.length) configuration.sheets = sheets;
  if (actions.length) configuration.actions = actions;
  return configuration;
}

export function generateYaml(state) {
  const configuration = buildConfiguration(state);
  const validation = validateConfiguration(configuration);
  if (!validation.valid) {
    return { yaml: null, configuration, ...validation };
  }
  return {
    yaml: dump(configuration, {
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    }),
    configuration,
    ...validation,
  };
}

export function parseYaml(text) {
  const raw = load(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The YAML root must be a configuration object.');
  }
  const validation = validateConfiguration(raw);
  if (!validation.valid) {
    const message = validation.issues
      .map(issue => `${issue.pathText || 'configuration'}: ${issue.message}`)
      .join('\n');
    throw new Error(message);
  }
  return validation.data;
}

export function buildActionConfiguration(action) {
  const result = {
    type: action.type,
    name: String(action.name || '').trim(),
  };
  if (Number(action.waitBeforeSeconds) > 0) {
    result.waitBeforeSeconds = Number(action.waitBeforeSeconds);
  }
  if (action.continueOnError) result.continueOnError = true;
  if (action.errorSheet?.trim()) result.errorSheet = action.errorSheet.trim();
  if (action.errorRows === 'all') result.errorRows = 'all';

  switch (action.type) {
    case 'get':
      result.outputSheet = value(action.outputSheet);
      result.query = value(action.query);
      break;
    case 'transform':
      result.inputSheet = value(action.inputSheet);
      result.outputSheet = value(action.outputSheet);
      break;
    case 'insert':
      result.object = value(action.object);
      result.inputSheet = value(action.inputSheet);
      addFields(result, action.fields);
      if (action.outputSheet?.trim()) result.outputSheet = action.outputSheet.trim();
      break;
    case 'update':
      result.object = value(action.object);
      result.inputSheet = value(action.inputSheet);
      addFields(result, action.fields);
      break;
    case 'upsert':
      result.object = value(action.object);
      result.inputSheet = value(action.inputSheet);
      result.externalIdField = value(action.externalIdField);
      addFields(result, action.fields);
      break;
    case 'delete':
      result.object = value(action.object);
      result.inputSheet = value(action.inputSheet);
      break;
    case 'merge':
      result.primarySheet = value(action.primarySheet);
      result.secondarySheet = value(action.secondarySheet);
      result.outputSheet = value(action.outputSheet);
      result.idField = value(action.idField);
      break;
    case 'check': {
      const inputSheets = cleanFields(action.inputSheets);
      if (inputSheets.length) result.inputSheets = inputSheets;
      break;
    }
  }
  return result;
}

function cleanFields(fields = []) {
  return fields.map(field => String(field).trim()).filter(Boolean);
}

function addFields(result, fields) {
  const cleaned = cleanFields(fields);
  if (cleaned.length) result.fields = cleaned;
}

function value(input) {
  return String(input || '').trim();
}

function optionalPositiveNumber(input) {
  if (input === '' || input === null || input === undefined) return null;
  const number = Number(input);
  return Number.isFinite(number) ? number : input;
}

const MARKER_START = '// >>> action: ';
const MARKER_END = '// <<< action: ';

function escapeMarker(name) {
  return String(name).replace(/[\r\n]/g, ' ');
}

// Stitches every scripted action's editor content (transforms and checks) into a
// single CommonJS module keyed by action name. Both action types are loaded from the
// same --scriptFile. Sentinel comments let importSharedScript split it back apart.
export function buildSharedScript(state) {
  const scripted = state.actions.filter(action => action.type === 'transform' || action.type === 'check');
  if (!scripted.length) return '';
  const entries = scripted.map(action => {
    const name = escapeMarker(action.name || 'Unnamed action');
    const body = wrapAsFunction(action.scriptContent || '', name);
    return `  ${MARKER_START}${name}\n${indent(body)},\n  ${MARKER_END}${name}`;
  });
  return `module.exports = {\n${entries.join('\n\n')}\n};\n`;
}

// A transform editor holds a full `module.exports = function (...) { ... }` (optionally
// preceded by a doc comment). Convert that to an anonymous function expression usable as
// an object property value. If the content is not in the expected shape, fall back to a
// no-op so the shared file stays syntactically valid.
function wrapAsFunction(content, name) {
  const key = JSON.stringify(name);
  const fn = extractFunction(content);
  return `${key}: ${fn}`;
}

// Pulls the `function ...` expression out of `module.exports = function ...;`, ignoring
// any leading comments/whitespace and the trailing semicolon, and drops the function name.
function extractFunction(content) {
  const match = String(content).match(/module\.exports\s*=\s*(function\b[\s\S]*?)\s*;?\s*$/);
  if (!match) return 'function (row) {\n  return row;\n}';
  return match[1].replace(/^function\s+[A-Za-z0-9_$]+\s*\(/, 'function (').trim();
}

function indent(text) {
  return text.split('\n').map(line => (line ? `    ${line}` : line)).join('\n');
}

// Splits a shared script file back into { [actionName]: scriptContent } so each function
// round-trips into its per-action editor. Prefers the sentinel markers written by
// buildSharedScript; when a hand-authored file has no markers, falls back to locating each
// known action name as an object key and extracting its function by brace matching.
// `knownNames` are the transform action names from the YAML (used by the fallback).
// Returns null only when neither markers nor any known key can be found.
export function parseSharedScript(text, knownNames = []) {
  if (!text) return null;
  if (text.includes(MARKER_START)) return parseWithMarkers(text);
  return parseByKeys(text, knownNames);
}

function parseWithMarkers(text) {
  const result = {};
  const lines = text.split('\n');
  let currentName = null;
  let buffer = [];
  for (const line of lines) {
    const startIndex = line.indexOf(MARKER_START);
    const endIndex = line.indexOf(MARKER_END);
    if (startIndex !== -1) {
      currentName = line.slice(startIndex + MARKER_START.length).trim();
      buffer = [];
      continue;
    }
    if (endIndex !== -1 && currentName !== null) {
      result[currentName] = editorContentFromEntry(buffer.join('\n'));
      currentName = null;
      buffer = [];
      continue;
    }
    if (currentName !== null) buffer.push(line);
  }
  return result;
}

// Inspects a shared script file and reports what the importer can and cannot use, so the
// UI can tell the user precisely what is wrong instead of silently blanking editors.
// Returns { hasExports, hasMarkers, keys, moduleLevel } where `keys` are the quoted object
// keys found (action-name candidates) and `moduleLevel` flags top-level const/require that
// would not survive a UI round-trip.
export function analyzeSharedScript(text) {
  const source = String(text || '');
  const hasMarkers = source.includes(MARKER_START);
  const hasExports = /module\.exports\s*=/.test(source);
  const keys = hasMarkers ? markerNames(source) : objectKeys(source);
  // Anything declared before the export is module-level scope that per-action editors lose.
  const preamble = source.split(/module\.exports\s*=/)[0] || '';
  const moduleLevel = /^\s*(?:const|let|var)\b/m.test(preamble) || /\brequire\s*\(/.test(preamble);
  return { hasExports, hasMarkers, keys, moduleLevel };
}

function markerNames(text) {
  const names = [];
  for (const line of text.split('\n')) {
    const index = line.indexOf(MARKER_START);
    if (index !== -1) names.push(line.slice(index + MARKER_START.length).trim());
  }
  return names;
}

// Collects the quoted keys that are immediately followed by a function/arrow value, i.e. the
// action-name candidates in a shared object literal. Walks the source honoring strings and
// comments so a quote inside a comment or string body is never mistaken for a key.
function objectKeys(text) {
  const keys = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const close = skipString(text, index, char);
      const raw = text.slice(index + 1, close);
      // Only a quoted token followed by `: function|(` (an arrow or function value) is a key.
      const after = text.slice(close + 1).match(/^\s*:\s*(?:async\s+)?(?:function\b|\()/);
      if (after && char !== '`') keys.push(raw.replace(/\\(.)/g, '$1'));
      index = close;
      continue;
    }
  }
  return keys;
}

// Locates each `'<name>': function ... { ... }` entry by its exact key and captures the
// function expression by counting braces/parens while skipping strings and comments.
function parseByKeys(text, knownNames) {
  const result = {};
  let found = false;
  for (const name of knownNames) {
    const fn = extractEntryByKey(text, name);
    if (fn) {
      result[name] = `module.exports = ${fn};\n`;
      found = true;
    }
  }
  return found ? result : null;
}

// Finds `"<name>"` or `'<name>'` used as an object key, then returns the source of the
// function value that follows the colon, balanced across braces/parens.
function extractEntryByKey(text, name) {
  const quoted = ['"', "'"].map(q => `${q}${escapeForRegex(name)}${q}`).join('|');
  const keyRegex = new RegExp(`(?:${quoted})\\s*:\\s*`, 'g');
  const match = keyRegex.exec(text);
  if (!match) return null;
  return balancedExpression(text, keyRegex.lastIndex);
}

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reads a balanced expression starting at `start`, honoring nested (), {}, [], string
// literals (', ", `) and // and /* */ comments. Stops at the top-level comma/brace that
// ends the object property value.
function balancedExpression(text, start) {
  let depth = 0;
  let index = start;
  const opens = { '(': ')', '{': '}', '[': ']' };
  const closes = { ')': 1, '}': 1, ']': 1 };
  for (; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipString(text, index, char);
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      index = text.indexOf('\n', index);
      if (index === -1) index = text.length;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (opens[char]) {
      depth++;
    } else if (closes[char]) {
      if (depth === 0) break; // hit the object's own closing brace
      depth--;
    } else if (char === ',' && depth === 0) {
      break; // end of this property value
    }
  }
  return text.slice(start, index).trim() || null;
}

function skipString(text, start, quote) {
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      index++;
      continue;
    }
    if (char === quote) return index;
    if (quote === '`' && char === '$' && text[index + 1] === '{') {
      // Skip a template-literal ${...} expression, honoring nested braces.
      let depth = 1;
      index += 2;
      for (; index < text.length && depth > 0; index++) {
        if (text[index] === '{') depth++;
        else if (text[index] === '}') depth--;
      }
      index--;
    }
  }
  return text.length;
}

// Turns a captured `"Name": function (...) { ... }` entry back into the standalone
// `module.exports = function ...` form the CodeMirror editor expects.
function editorContentFromEntry(entry) {
  const dedented = dedent(entry).trim().replace(/,\s*$/, '');
  const match = dedented.match(/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:\s*([\s\S]*)$/);
  const fn = match ? match[1].trim() : dedented;
  return `module.exports = ${fn};\n`;
}

function dedent(text) {
  const lines = text.split('\n');
  const indents = lines.filter(line => line.trim()).map(line => line.match(/^ */)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map(line => line.slice(min)).join('\n');
}
