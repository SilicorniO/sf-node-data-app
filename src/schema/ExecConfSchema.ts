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

export const actionSchema = z.union([
  getActionSchema,
  insertActionSchema,
  updateActionSchema,
  upsertActionSchema,
  deleteActionSchema,
  transformActionSchema,
  mergeActionSchema,
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
