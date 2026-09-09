'use strict';

// Pure module: config `state` -> { nodes, edges, columns }.
//
// Timeline model (see web/DIAGRAM_TIMELINE_PLAN.md):
//   The graph reads left-to-right as a timeline of actions. Each action is a
//   *moment* = one invisible column. Sheets are boxes; actions are the vectors
//   (arrows) between boxes and always carry a visible name label.
//
//   A box lives in the column of the action that PRODUCED it (its output CSV
//   and/or a per-action Salesforce box). When an action CONSUMES a sheet made
//   earlier, a vector reaches across columns from that earlier box.
//
//   - Column 0 holds pre-existing input sheets (read but never produced).
//   - Column i+1 holds what action i produces.
//   - GET / writes get their OWN local Salesforce box (no shared hub).
//   - A re-written sheet gets a new box per write (latest-write-wins for reads);
//     the newer box is flagged `supersedes` for a badge.
//   - Error sheets appear only when a later action consumes them.

const norm = value => String(value ?? '').trim().toLowerCase();

const isWriteAction = type => ['insert', 'update', 'upsert', 'delete'].includes(type);
const isSalesforceAction = type => type === 'get' || isWriteAction(type);

// The error sheet an action produces (explicit or the default `${name}-errors`).
function errorSheetName(action) {
  const explicit = String(action.errorSheet ?? '').trim();
  if (explicit) return explicit;
  const name = String(action.name ?? '').trim();
  return name ? `${name}-errors` : '';
}

// Every sheet an action reads from.
function inputSheetsOf(action) {
  if (action.type === 'merge') return [action.primarySheet, action.secondarySheet];
  if (action.type === 'get') return [];
  if (action.type === 'transform') return [action.inputSheet];
  if (isWriteAction(action.type)) return [action.inputSheet];
  return [];
}

// The data sheet an action writes (single output CSV; error sheets handled apart).
function outputSheetOf(action) {
  if (action.type === 'get') return action.outputSheet;
  if (action.type === 'transform' || action.type === 'merge') return action.outputSheet;
  if (action.type === 'insert') return action.outputSheet; // optional returned-Ids sheet
  return ''; // update/upsert/delete: no data output
}

/**
 * Build the timeline graph from the editor state.
 * @returns {{ nodes: Array, edges: Array, columnCount: number }}
 *   node = { id, kind:'sheet'|'salesforce', column, lane, name?, fieldCount?,
 *            isError?, supersedes? }
 *   edge = { id, from, to, type, name, object, labeled, role, actionIndex }
 */
export function buildDiagramGraph(state, catalog = []) {
  const actions = state.actions || [];

  // Declared field counts by normalized sheet name (from sheetCatalog).
  const fieldCountByName = new Map();
  catalog.forEach(sheet => fieldCountByName.set(norm(sheet.name), (sheet.fields || []).length));

  // Sheet names consumed as input by some action (drives orphan/error hiding).
  const consumed = new Set();
  actions.forEach(action => inputSheetsOf(action).forEach(name => { if (name) consumed.add(norm(name)); }));

  const errorNames = new Set();
  actions.forEach(action => {
    const name = errorSheetName(action);
    if (name) errorNames.add(norm(name));
  });

  // Sheet names produced by some action (so column-0 = read-but-never-produced).
  const producedNames = new Set();
  actions.forEach(action => {
    const out = outputSheetOf(action);
    if (out) producedNames.add(norm(out));
    const err = errorSheetName(action);
    if (err && consumed.has(norm(err))) producedNames.add(norm(err));
  });

  const nodes = [];
  const edges = [];

  // latest box id producing a given sheet name, so reads resolve to the most
  // recent writer (latest-write-wins) and rewrites can flag `supersedes`.
  const latestSheetBox = new Map(); // normKey -> nodeId
  let laneSeq = 0; // stable vertical ordering hint within a column

  const makeSheetNode = (name, column, { isError = false, supersedes = false } = {}) => {
    const key = norm(name);
    const id = `sheet:${column}:${key}`;
    nodes.push({
      id,
      kind: 'sheet',
      column,
      lane: laneSeq++,
      name,
      fieldCount: fieldCountByName.get(key) ?? null,
      isError,
      supersedes,
    });
    latestSheetBox.set(key, id);
    return id;
  };

  const makeSalesforceNode = (column, actionIndex) => {
    const id = `sf:${actionIndex}`;
    nodes.push({ id, kind: 'salesforce', column, lane: laneSeq++, name: 'Salesforce' });
    return id;
  };

  // Pre-existing input sheets (referenced but never produced) are placed in the
  // moment just *before* the first action that uses them, so their vector points
  // one column forward instead of dangling all the way back at column 0.
  actions.forEach((action, index) => {
    inputSheetsOf(action).forEach(name => {
      if (!name) return;
      const key = norm(name);
      if (producedNames.has(key)) return;      // produced later/earlier, not a source
      if (latestSheetBox.has(key)) return;     // already placed
      // First use is at column index+1; put the source in the previous moment.
      makeSheetNode(name, Math.max(0, index), {});
    });
  });

  // Resolve the box a read should attach to (the latest producer so far, else a
  // column-0 source that must already exist). Returns null when not drawable.
  const resolveInput = name => {
    if (!name) return null;
    return latestSheetBox.get(norm(name)) || null;
  };

  actions.forEach((action, index) => {
    const column = index + 1;
    const base = {
      type: action.type,
      name: action.name || '',
      object: action.object || '',
      actionIndex: index,
    };
    let edgeSeq = 0;
    const pushEdge = (from, to, role, labeled) => {
      if (!from || !to) return;
      edges.push({ id: `edge:${index}:${edgeSeq++}`, from, to, role, labeled, ...base });
    };

    // Does producing this output overwrite a prior sheet of the same name?
    const outName = outputSheetOf(action);
    const overwrites = outName && latestSheetBox.has(norm(outName));

    if (action.type === 'get') {
      // Salesforce is the SOURCE, so it sits in the previous moment; the output
      // CSV is produced in this action's moment. The action arrow advances the
      // timeline horizontally (never stacked within one moment).
      const sf = makeSalesforceNode(column - 1, index);
      const out = outName ? makeSheetNode(outName, column, { supersedes: overwrites }) : null;
      pushEdge(sf, out, 'read', true);

    } else if (action.type === 'transform') {
      // input (past column) --labeled--> [output CSV]
      const from = resolveInput(action.inputSheet);
      const out = outName ? makeSheetNode(outName, column, { supersedes: overwrites }) : null;
      pushEdge(from, out, 'transform', true);

    } else if (action.type === 'merge') {
      // primary + secondary --labeled--> [output CSV] (both vectors converge)
      const primary = resolveInput(action.primarySheet);
      const secondary = resolveInput(action.secondarySheet);
      const out = outName ? makeSheetNode(outName, column, { supersedes: overwrites }) : null;
      pushEdge(primary, out, 'merge-primary', true);
      pushEdge(secondary, out, 'merge-secondary', true);

    } else if (isWriteAction(action.type)) {
      // input --labeled--> [Salesforce] (Salesforce marks the output).
      // If an output sheet is defined: [Salesforce] --> [output CSV] (unlabeled).
      const from = resolveInput(action.inputSheet);
      const sf = makeSalesforceNode(column, index);
      pushEdge(from, sf, 'write', true);
      if (outName) {
        const out = makeSheetNode(outName, column, { supersedes: overwrites });
        pushEdge(sf, out, 'write-output', false);
      }
    }

    // Error sheet: shown only when a later action consumes it.
    const err = errorSheetName(action);
    if (err && consumed.has(norm(err))) {
      makeSheetNode(err, column, { isError: true, supersedes: latestSheetBox.has(norm(err)) });
    }
  });

  const columnCount = actions.length + 1;
  return { nodes, edges, columnCount };
}
