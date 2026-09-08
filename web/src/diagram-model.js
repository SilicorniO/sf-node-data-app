'use strict';

// Pure module: config `state` -> { nodes, edges }.
//
// Model (see web/DIAGRAM_VIEW_PLAN.md):
//   Nodes  = sheet boxes that participate in the dataflow, plus one shared
//            Salesforce node when any get/write action exists.
//   Edges  = actions, one arrow per action mapped by type. Salesforce is the
//            source (get) or sink (writes) for every Salesforce operation.
//
// Sheet visibility rules:
//   - A sheet appears only if some action references it (input or output).
//   - Error sheets appear only when another action consumes them as an input.
//   - Orphan sheets (declared but never referenced) are hidden.

export const SALESFORCE_NODE_ID = '__salesforce__';

const norm = value => String(value ?? '').trim().toLowerCase();

// Actions whose data crosses to/from Salesforce.
const isSalesforceAction = type => type === 'get' || isWriteAction(type);
const isWriteAction = type => ['insert', 'update', 'upsert', 'delete'].includes(type);

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
  return [action.inputSheet];
}

// Every sheet an action writes to (data sheets only; error sheets handled apart).
function outputSheetsOf(action) {
  if (action.type === 'get') return [action.outputSheet];
  if (action.type === 'transform' || action.type === 'merge') return [action.outputSheet];
  if (action.type === 'insert') return [action.outputSheet];
  return [];
}

/**
 * Build the diagram graph from the editor state.
 * @returns {{ nodes: Array, edges: Array }}
 *   node  = { id, kind: 'sheet'|'salesforce', name, fieldCount, isError, sheet? }
 *   edge  = { id, from, to, type, name, object, step, role }
 */
export function buildDiagramGraph(state, catalog = []) {
  const actions = state.actions || [];

  // Look up declared field counts by normalized sheet name (from sheetCatalog).
  const fieldCountByName = new Map();
  catalog.forEach(sheet => fieldCountByName.set(norm(sheet.name), (sheet.fields || []).length));

  // Which sheet names are consumed as an input by *some* action. Drives both
  // orphan hiding and the "error sheet only if consumed" rule.
  const consumed = new Set();
  actions.forEach(action => {
    inputSheetsOf(action).forEach(name => { if (name) consumed.add(norm(name)); });
  });

  // Error sheet names, so we can tag nodes and only surface consumed ones.
  const errorNames = new Set();
  actions.forEach(action => {
    const name = errorSheetName(action);
    if (name) errorNames.add(norm(name));
  });

  const nodes = new Map(); // key: normalized name -> node
  let needsSalesforce = false;

  const addSheetNode = name => {
    if (!name) return null;
    const key = norm(name);
    if (nodes.has(key)) return nodes.get(key);
    const node = {
      id: `sheet:${key}`,
      kind: 'sheet',
      name,
      fieldCount: fieldCountByName.get(key) ?? null,
      isError: errorNames.has(key),
    };
    nodes.set(key, node);
    return node;
  };

  const sheetNodeId = name => {
    const key = norm(name);
    // Only reference a sheet as an edge endpoint if it is a visible node.
    return nodes.has(key) ? nodes.get(key).id : null;
  };

  // First pass: create the sheet nodes that are actually visible.
  actions.forEach(action => {
    inputSheetsOf(action).forEach(name => { if (name) addSheetNode(name); });
    outputSheetsOf(action).forEach(name => { if (name) addSheetNode(name); });
    // An error sheet becomes a node only when another action consumes it.
    const err = errorSheetName(action);
    if (err && consumed.has(norm(err))) addSheetNode(err);
    if (isSalesforceAction(action.type)) needsSalesforce = true;
  });

  const salesforceNode = needsSalesforce
    ? { id: SALESFORCE_NODE_ID, kind: 'salesforce', name: 'Salesforce' }
    : null;

  // Second pass: build edges. `role` distinguishes converging merge/id arrows.
  const edges = [];
  actions.forEach((action, index) => {
    const step = index + 1;
    const base = { type: action.type, name: action.name || '', object: action.object || '', step };

    const push = (from, to, role) => {
      if (!from || !to) return; // skip if an endpoint sheet isn't visible
      edges.push({ id: `edge:${index}:${role}`, from, to, role, ...base });
    };

    if (action.type === 'get') {
      push(salesforceNode?.id, sheetNodeId(action.outputSheet), 'read');
    } else if (action.type === 'transform') {
      push(sheetNodeId(action.inputSheet), sheetNodeId(action.outputSheet), 'transform');
    } else if (action.type === 'merge') {
      push(sheetNodeId(action.primarySheet), sheetNodeId(action.outputSheet), 'merge-primary');
      push(sheetNodeId(action.secondarySheet), sheetNodeId(action.outputSheet), 'merge-secondary');
    } else if (isWriteAction(action.type)) {
      push(sheetNodeId(action.inputSheet), salesforceNode?.id, 'write');
      // insert with an id-output sheet: Salesforce returns the new Ids.
      if (action.type === 'insert' && action.outputSheet) {
        push(salesforceNode?.id, sheetNodeId(action.outputSheet), 'write-output');
      }
    }
  });

  const nodeList = [...nodes.values()];
  if (salesforceNode) nodeList.unshift(salesforceNode);
  return { nodes: nodeList, edges };
}
