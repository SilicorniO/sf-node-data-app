import { z } from 'zod';

const trimmed = z.string().trim().min(1);
const safeLogicalName = trimmed.refine(
  value => !value.includes('/') && !value.includes('\\') && !value.includes('..') && !/[\u0000-\u001f]/.test(value),
  'must not contain path separators, "..", or control characters'
);

const actionCommon = {
  name: safeLogicalName,
  waitBeforeSeconds: z.number().nonnegative().default(0),
  continueOnError: z.boolean().default(false),
  errorSheet: safeLogicalName.optional(),
  errorRows: z.enum(['errors', 'all']).default('errors'),
};

const fields = z.array(trimmed).default([]).refine(
  values => new Set(values.map(value => value.toLocaleLowerCase())).size === values.length,
  'must not contain duplicate field names'
);

const getActionSchema = z.object({
  ...actionCommon,
  type: z.literal('get'),
  outputSheet: safeLogicalName,
  query: trimmed,
}).strict();

const transformActionSchema = z.object({
  ...actionCommon,
  type: z.literal('transform'),
  inputSheet: safeLogicalName,
  outputSheet: safeLogicalName,
}).strict();

const insertActionSchema = z.object({
  ...actionCommon,
  type: z.literal('insert'),
  object: trimmed,
  inputSheet: safeLogicalName,
  outputSheet: safeLogicalName.optional(),
  fields,
}).strict().superRefine((action, context) => {
  if (action.fields.some(field => field.toLocaleLowerCase() === 'id')) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'INSERT fields must not contain Id' });
  }
});

const updateActionSchema = z.object({
  ...actionCommon,
  type: z.literal('update'),
  object: trimmed,
  inputSheet: safeLogicalName,
  fields,
}).strict().superRefine((action, context) => {
  if (action.fields.length > 0 && !action.fields.some(field => field.toLocaleLowerCase() === 'id')) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'UPDATE fields must contain Id' });
  }
});

const upsertActionSchema = z.object({
  ...actionCommon,
  type: z.literal('upsert'),
  object: trimmed,
  inputSheet: safeLogicalName,
  fields,
  externalIdField: trimmed,
}).strict().superRefine((action, context) => {
  if (
    action.fields.length > 0
    && !action.fields.some(field => field.toLocaleLowerCase() === action.externalIdField.toLocaleLowerCase())
  ) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'UPSERT fields must contain externalIdField' });
  }
});

const deleteActionSchema = z.object({
  ...actionCommon,
  type: z.literal('delete'),
  object: trimmed,
  inputSheet: safeLogicalName,
}).strict();

const mergeActionSchema = z.object({
  ...actionCommon,
  type: z.literal('merge'),
  primarySheet: safeLogicalName,
  secondarySheet: safeLogicalName,
  outputSheet: safeLogicalName,
  idField: trimmed,
}).strict().superRefine((action, context) => {
  if (action.primarySheet.toLocaleLowerCase() === action.secondarySheet.toLocaleLowerCase()) {
    context.addIssue({ code: 'custom', path: ['secondarySheet'], message: 'secondarySheet must differ from primarySheet' });
  }
});

const checkActionSchema = z.object({
  ...actionCommon,
  type: z.literal('check'),
  inputSheets: z.array(safeLogicalName).default([]).refine(
    values => new Set(values.map(value => value.toLocaleLowerCase())).size === values.length,
    'must not contain duplicate sheet names'
  ),
}).strict();

const millerActionSchema = z.object({
  ...actionCommon,
  type: z.literal('miller'),
  inputSheets: z.array(safeLogicalName).min(1, 'must reference at least one input sheet').refine(
    values => new Set(values.map(value => value.toLocaleLowerCase())).size === values.length,
    'must not contain duplicate sheet names'
  ),
  outputSheet: safeLogicalName,
  // The verb chain only. The app supplies `mlr --csv`, the input files, and the
  // output redirection, so those must not appear here.
  command: trimmed,
}).strict().superRefine((action, context) => {
  const command = action.command;
  if (/^\s*mlr\b/i.test(command)) {
    context.addIssue({ code: 'custom', path: ['command'], message: 'command must not start with "mlr"; the app adds it' });
  }
  if (/(^|\s)--(i|o|io)?csv\b/.test(command) || /(^|\s)--c2\w+\b/.test(command)) {
    context.addIssue({ code: 'custom', path: ['command'], message: 'command must not set the CSV format; the app adds "--csv"' });
  }
  // `{{sheetName}}` placeholders are substituted with an input's CSV path at run time
  // (e.g. Miller `join -f {{left}}`), so each must name a declared input sheet.
  const inputs = new Set(action.inputSheets.map(sheet => sheet.toLocaleLowerCase()));
  for (const match of command.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    const name = match[1];
    if (!inputs.has(name.toLocaleLowerCase())) {
      context.addIssue({ code: 'custom', path: ['command'], message: `command placeholder {{${name}}} must name one of inputSheets` });
    }
  }
  // Shell metacharacters (`; & | > <` etc.) are NOT rejected: the command is
  // tokenized in-process and passed to execFile as an argv array with no shell, so
  // they carry no shell meaning. Rejecting them would break legitimate Miller DSL
  // expressions such as `filter '$age > 30'`.
});

const columnTypeSchema = z.enum(['TEXT', 'INTEGER', 'REAL', 'NUMERIC']);

const tableActionSchema = z.object({
  ...actionCommon,
  type: z.literal('table'),
  inputSheet: safeLogicalName,
  // Optional per-column overrides. `source` is the sheet's field name; `name` renames
  // it in the table; `type` sets the SQLite storage type. Unlisted fields keep their
  // name and TEXT.
  columns: z.array(z.object({
    source: trimmed,
    name: trimmed.optional(),
    type: columnTypeSchema.optional(),
  }).strict()).default([]),
}).strict().superRefine((action, context) => {
  const sources = action.columns.map(column => column.source.toLocaleLowerCase());
  if (new Set(sources).size !== sources.length) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'must not reference the same source column twice' });
  }
  // Detect rename collisions among explicitly named columns (case-insensitive). A
  // collision with an unlisted, retained field name is caught at runtime against the
  // real header, which the schema cannot see.
  const targets = action.columns
    .filter(column => column.name)
    .map(column => column.name!.toLocaleLowerCase());
  if (new Set(targets).size !== targets.length) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'renamed column names must be unique ignoring case' });
  }
});

const sqlActionSchema = z.object({
  ...actionCommon,
  type: z.literal('sql'),
  inputSheets: z.array(safeLogicalName).min(1, 'must reference at least one table sheet').refine(
    values => new Set(values.map(value => value.toLocaleLowerCase())).size === values.length,
    'must not contain duplicate sheet names'
  ),
  outputSheet: safeLogicalName,
  query: trimmed,
}).strict().superRefine((action, context) => {
  // Only read queries are allowed, so cached tables cannot be mutated or dropped.
  if (!/^\s*(select|with)\b/i.test(action.query)) {
    context.addIssue({ code: 'custom', path: ['query'], message: 'query must be a read-only SELECT (or WITH ... SELECT)' });
  }
});

export const actionSchema = z.union([
  getActionSchema,
  insertActionSchema,
  updateActionSchema,
  upsertActionSchema,
  deleteActionSchema,
  transformActionSchema,
  mergeActionSchema,
  checkActionSchema,
  millerActionSchema,
  tableActionSchema,
  sqlActionSchema,
]);

const appConfigurationSchema = z.object({
  processingType: z.enum(['api', 'bulk', 'auto']).default('api'),
  bulkApiMaxWaitSec: z.number().positive().nullable().default(null),
  bulkApiPollIntervalSec: z.number().positive().nullable().default(null),
  apiVersion: trimmed.default('58.0'),
  cleanOutputFolderBeforeExecution: z.boolean().default(false),
  deleteErrorFilesBeforeExecution: z.boolean().default(false),
  queryApiBatchSize: z.number().int().min(200).max(2000).default(2000),
  // Auto mode cutover: at or above this record count an action uses Bulk API v2,
  // below it the synchronous API.
  autoBulkThreshold: z.number().int().positive().default(10000),
}).strict().default({
  processingType: 'api',
  bulkApiMaxWaitSec: null,
  bulkApiPollIntervalSec: null,
  apiVersion: '58.0',
  cleanOutputFolderBeforeExecution: false,
  deleteErrorFilesBeforeExecution: false,
  queryApiBatchSize: 2000,
  autoBulkThreshold: 10000,
});

const sheetSchema = z.object({
  name: safeLogicalName,
  fields: z.array(z.object({
    name: trimmed,
    apiName: trimmed.optional(),
  }).strict()).default([]),
}).strict();

export const execConfSchema = z.object({
  appConfiguration: appConfigurationSchema,
  sheets: z.array(sheetSchema).default([]),
  actions: z.array(actionSchema).default([]),
}).strict().superRefine((configuration, context) => {
  const actionNames = new Set<string>();
  const declaredSheetNames = new Set<string>();

  configuration.actions.forEach((action, index) => {
    const normalizedName = action.name.toLocaleLowerCase();
    if (actionNames.has(normalizedName)) {
      context.addIssue({ code: 'custom', path: ['actions', index, 'name'], message: 'action names must be unique ignoring case' });
    }
    actionNames.add(normalizedName);

    const errorSheet = (action.errorSheet ?? `${action.name}-errors`).toLocaleLowerCase();
    const normalSheets = [
      'inputSheet' in action ? action.inputSheet : undefined,
      'outputSheet' in action ? action.outputSheet : undefined,
      'primarySheet' in action ? action.primarySheet : undefined,
      'secondarySheet' in action ? action.secondarySheet : undefined,
      ...('inputSheets' in action ? action.inputSheets : []),
    ].filter((value): value is string => Boolean(value));
    if (normalSheets.some(sheet => sheet.toLocaleLowerCase() === errorSheet)) {
      context.addIssue({ code: 'custom', path: ['actions', index, 'errorSheet'], message: 'errorSheet must differ from this action inputSheet and outputSheet' });
    }
  });

  configuration.sheets.forEach((sheet, index) => {
    const normalizedName = sheet.name.toLocaleLowerCase();
    if (declaredSheetNames.has(normalizedName)) {
      context.addIssue({ code: 'custom', path: ['sheets', index, 'name'], message: 'sheet names must be unique ignoring case' });
    }
    declaredSheetNames.add(normalizedName);
  });
});

export type ParsedExecConf = z.infer<typeof execConfSchema>;
