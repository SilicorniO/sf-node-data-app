import { dump, load } from 'js-yaml';
import { validateConfiguration } from './validation.js';

export function buildConfiguration(state) {
  const app = state.appConfiguration;
  const appConfiguration = {
    processingType: app.processingType || 'bulk',
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
      result.script = value(action.script);
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
