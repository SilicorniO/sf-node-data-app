import { uid } from './state.js';

export const ACTION_TYPES = [
  { value: 'get', label: 'GET', description: 'Query Salesforce into a sheet' },
  { value: 'insert', label: 'INSERT', description: 'Create Salesforce records from a sheet' },
  { value: 'update', label: 'UPDATE', description: 'Update Salesforce records by Id' },
  { value: 'upsert', label: 'UPSERT', description: 'Create or update by external ID' },
  { value: 'delete', label: 'DELETE', description: 'Delete Salesforce records by Id' },
  { value: 'transform', label: 'TRANSFORM', description: 'Run a JavaScript module per row' },
  { value: 'merge', label: 'MERGE', description: 'Merge two sheets into one by an id field' },
  { value: 'check', label: 'CHECK', description: 'Assert a condition with a JavaScript function' },
];

export function createAction(type = 'get', source = {}) {
  const action = {
    id: source.id || uid(),
    type,
    name: source.name || '',
    waitBeforeSeconds: source.waitBeforeSeconds ?? 0,
    continueOnError: source.continueOnError ?? false,
    errorSheet: source.errorSheet || '',
    errorRows: source.errorRows || 'errors',
  };
  if (type === 'get') {
    Object.assign(action, { outputSheet: source.outputSheet || '', query: source.query || '' });
  } else if (type === 'merge') {
    Object.assign(action, {
      primarySheet: source.primarySheet || '',
      secondarySheet: source.secondarySheet || '',
      outputSheet: source.outputSheet || '',
      idField: source.idField || '',
    });
  } else if (type === 'transform') {
    Object.assign(action, {
      inputSheet: source.inputSheet || '',
      outputSheet: source.outputSheet || '',
      scriptContent: source.scriptContent || '',
    });
  } else if (type === 'check') {
    Object.assign(action, {
      inputSheets: [...(source.inputSheets || [])],
      scriptContent: source.scriptContent || '',
    });
  } else {
    Object.assign(action, {
      object: source.object || '',
      inputSheet: source.inputSheet || '',
    });
    if (type !== 'delete') action.fields = [...(source.fields || [])];
    if (type === 'insert') action.outputSheet = source.outputSheet || '';
    if (type === 'upsert') action.externalIdField = source.externalIdField || '';
  }
  return ensureIdentifierField(action);
}

export function changeActionType(action, type) {
  return createAction(type, {
    id: action.id,
    name: action.name,
    waitBeforeSeconds: action.waitBeforeSeconds,
    continueOnError: action.continueOnError,
    errorSheet: action.errorSheet,
    errorRows: action.errorRows,
    inputSheet: action.inputSheet,
    outputSheet: action.outputSheet,
    object: action.object,
    fields: action.fields,
    externalIdField: action.externalIdField,
    query: action.query,
    scriptContent: action.scriptContent,
    primarySheet: action.primarySheet,
    secondarySheet: action.secondarySheet,
    idField: action.idField,
    inputSheets: action.inputSheets,
  });
}

export function ensureIdentifierField(action) {
  if ('fields' in action && (action.fields || []).length === 0) {
    return action;
  }
  if (action.type === 'update') {
    action.fields = unique(['Id', ...(action.fields || []).filter(field => field.toLowerCase() !== 'id')]);
  } else if (action.type === 'upsert' && action.externalIdField?.trim()) {
    const identifier = action.externalIdField.trim();
    action.fields = unique([
      identifier,
      ...(action.fields || []).filter(field => field.toLowerCase() !== identifier.toLowerCase()),
    ]);
  } else if (action.type === 'insert') {
    action.fields = unique((action.fields || []).filter(field => field.toLowerCase() !== 'id'));
  }
  return action;
}

export function actionDescription(action) {
  if (action.type === 'get') return `Salesforce → ${action.outputSheet || 'output sheet'}`;
  if (action.type === 'transform') {
    return `${action.inputSheet || 'input'} → ${action.outputSheet || 'output'}`;
  }
  if (action.type === 'merge') {
    return `${action.primarySheet || 'primary'} + ${action.secondarySheet || 'secondary'} → ${action.outputSheet || 'output'}`;
  }
  if (action.type === 'check') {
    const inputs = (action.inputSheets || []).filter(Boolean);
    return `check ${inputs.length ? inputs.join(', ') : 'condition'}`;
  }
  const target = action.object || 'Salesforce object';
  return `${action.inputSheet || 'input sheet'} → ${target}`;
}

export function sheetCatalog(state, beforeIndex = state.actions.length) {
  const catalog = [];
  const add = (name, fields = []) => {
    if (!name) return;
    const existing = catalog.find(sheet => sheet.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (fields.length) existing.fields = unique(fields);
      return;
    }
    catalog.push({ name, fields: unique(fields) });
  };

  state.sheets.forEach(sheet => add(
    sheet.name,
    (sheet.fields || []).map(field => field.translate && field.apiName ? field.apiName : field.name).filter(Boolean)
  ));
  state.actions.slice(0, beforeIndex).forEach(action => {
    const inputFields = catalog.find(sheet => sheet.name.toLowerCase() === action.inputSheet?.toLowerCase())?.fields || [];
    if (action.type === 'get') add(action.outputSheet, deriveSoqlFields(action.query));
    if (action.type === 'transform') add(action.outputSheet, inputFields);
    if (action.type === 'merge') {
      const primaryFields = catalog.find(sheet => sheet.name.toLowerCase() === action.primarySheet?.toLowerCase())?.fields || [];
      const secondaryFields = catalog.find(sheet => sheet.name.toLowerCase() === action.secondarySheet?.toLowerCase())?.fields || [];
      add(action.outputSheet, [...primaryFields, ...secondaryFields]);
    }
    if (action.type === 'insert' && action.outputSheet) add(action.outputSheet, ['_InputRow', 'Id']);
    const errorName = action.errorSheet || `${action.name}-errors`;
    // GET and CHECK error sheets carry only the error message; row-based actions
    // prepend the input sheet's fields.
    add(errorName, action.type === 'get' || action.type === 'check' ? ['_ErrorMessage'] : [...inputFields, '_ErrorMessage']);
  });
  return catalog;
}

function deriveSoqlFields(query = '') {
  const match = query.match(/^\s*select\s+([\s\S]+?)\s+from\s+/i);
  if (!match) return [];
  const fields = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= match[1].length; index++) {
    const character = match[1][index];
    if (character === '(') depth++;
    if (character === ')') depth--;
    if ((character === ',' && depth === 0) || index === match[1].length) {
      const expression = match[1].slice(start, index).trim();
      if (expression) {
        const alias = expression.match(/\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
        fields.push(alias && /[()]/.test(expression) ? alias[1] : expression);
      }
      start = index + 1;
    }
  }
  return fields;
}

function unique(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
