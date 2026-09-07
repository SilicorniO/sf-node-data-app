import { Action } from '../model/Action';
import { DataSheet } from '../model/DataSheet';
import { DeleteAction } from '../model/DeleteAction';
import { ExecConf } from '../model/ExecConf';
import { GetAction } from '../model/GetAction';
import { InsertAction } from '../model/InsertAction';
import { TransformAction } from '../model/TransformAction';
import { UpdateAction } from '../model/UpdateAction';
import { UpsertAction } from '../model/UpsertAction';
import { WriteAction } from '../model/WriteAction';
import { SalesforceApiLoader } from '../salesforce/SalesforceApiLoader';
import { SalesforceAuthenticator } from '../salesforce/SalesforceAuthenticator';
import { SalesforceBulkApiLoader } from '../salesforce/SalesforceBulkApiLoader';
import {
  PreparedWriteRow,
  SalesforceDataLoader,
  SalesforceWriteRequest,
  WriteRowResult,
} from '../salesforce/SalesforceOperation';
import { SheetRegistry } from './SheetRegistry';
import { TransformRow, TransformScriptRunner } from './TransformScriptRunner';

export interface PipelineResult {
  hadContinuedErrors: boolean;
}

export interface ActionExecutionRange {
  fromTask?: string;
  toTask?: string;
}

export interface ResolvedActionRange {
  start: number;
  end: number;
}

export class PipelineExecutionError extends Error {
  constructor(readonly actionName: string, message: string) {
    super(message);
    this.name = 'PipelineExecutionError';
  }
}

export class ConfigurationPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationPreflightError';
  }
}

export class ActionProcessor {
  static async processActions(
    execConf: ExecConf,
    sheetsInput: SheetRegistry | { [sheetName: string]: DataSheet },
    executionRange: ActionExecutionRange = {}
  ): Promise<PipelineResult> {
    const registry = sheetsInput instanceof SheetRegistry ? sheetsInput : new SheetRegistry(sheetsInput);
    const externalSheets = sheetsInput instanceof SheetRegistry ? undefined : sheetsInput;
    const transformRunner = new TransformScriptRunner();
    try {
      let range: ResolvedActionRange;
      try {
        range = resolveActionRange(execConf.actions, executionRange.fromTask, executionRange.toTask);
      } catch (error: any) {
        throw new ConfigurationPreflightError(error.message);
      }
      const selectedActions = range.end < range.start ? [] : execConf.actions.slice(range.start, range.end + 1);

      try {
        const transforms = selectedActions.filter(
          (action): action is TransformAction => action.type === 'transform'
        ) as TransformAction[];
        if (transforms.length > 0) {
          console.log(`      Precheck: loading ${transforms.length} transform script(s).`);
        }
        transformRunner.preflight(transforms);
      } catch (error: any) {
        throw new ConfigurationPreflightError(error.message);
      }

      let hadContinuedErrors = false;
      for (let index = range.start; index <= range.end; index++) {
        const action = execConf.actions[index];
        if (action.waitBeforeSeconds > 0) {
          console.log(`      [${index + 1}/${execConf.actions.length}] Waiting ${action.waitBeforeSeconds}s before "${action.name}".`);
          await new Promise(resolve => setTimeout(resolve, action.waitBeforeSeconds * 1000));
        }
        const startedAt = Date.now();
        console.log(`      [${index + 1}/${execConf.actions.length}] ${action.type.toUpperCase()} "${action.name}" — started`);
        let hadRowErrors: boolean;
        try {
          hadRowErrors = await this.executeAction(execConf, action, registry, transformRunner);
        } catch (error) {
          console.error(
            `      [${index + 1}/${execConf.actions.length}] ${action.type.toUpperCase()} `
            + `"${action.name}" — failed after ${formatDuration(Date.now() - startedAt)}`
          );
          throw error;
        }
        if (hadRowErrors) {
          console.warn(
            `      [${index + 1}/${execConf.actions.length}] ${action.type.toUpperCase()} `
            + `"${action.name}" — completed with row errors in ${formatDuration(Date.now() - startedAt)}`
          );
          if (!action.continueOnError) {
            throw new PipelineExecutionError(action.name, `Action "${action.name}" completed with row errors.`);
          }
          hadContinuedErrors = true;
        } else {
          console.log(
            `      [${index + 1}/${execConf.actions.length}] ${action.type.toUpperCase()} `
            + `"${action.name}" — completed in ${formatDuration(Date.now() - startedAt)}`
          );
        }
      }
      return { hadContinuedErrors };
    } finally {
      if (externalSheets) {
        for (const key of Object.keys(externalSheets)) delete externalSheets[key];
        Object.assign(externalSheets, registry.toObject());
      }
    }
  }

  private static async executeAction(
    execConf: ExecConf,
    action: Action,
    sheets: SheetRegistry,
    transformRunner: TransformScriptRunner
  ): Promise<boolean> {
    try {
      switch (action.type) {
        case 'get':
          await this.executeGet(execConf, action as GetAction, sheets);
          return false;
        case 'transform':
          return this.executeTransform(action as TransformAction, sheets, transformRunner);
        case 'insert':
        case 'update':
        case 'upsert':
        case 'delete':
          return await this.executeWrite(execConf, action as WriteAction, sheets);
      }
    } catch (error: any) {
      if (error instanceof PipelineExecutionError) throw error;
      this.writeFatalErrorSheet(action, sheets, error.message);
      throw new PipelineExecutionError(action.name, `Action "${action.name}" failed: ${error.message}`);
    }
  }

  private static async executeGet(execConf: ExecConf, action: GetAction, sheets: SheetRegistry): Promise<void> {
    const connection = await this.connection();
    let result: DataSheet;
    try {
      result = await new SalesforceBulkApiLoader(execConf.appConfiguration).query(
        connection.instanceUrl,
        connection.accessToken,
        action.query,
        action.outputSheet
      );
    } catch (error: any) {
      if (!isBulkQueryUnsupported(error)) throw error;
      console.warn(
        '        Query: Bulk API v2 does not support a selected field; '
        + `falling back to the synchronous Query API (batchSize ${execConf.appConfiguration.queryApiBatchSize}).`
      );
      result = await new SalesforceApiLoader(execConf.appConfiguration).query(
        connection.instanceUrl,
        connection.accessToken,
        action.query,
        action.outputSheet
      );
    }
    sheets.set(action.outputSheet, result);
    console.log(`        Output "${action.outputSheet}": ${result.data.length} row(s).`);
  }

  private static executeTransform(
    action: TransformAction,
    sheets: SheetRegistry,
    runner: TransformScriptRunner
  ): boolean {
    const input = sheets.require(action.inputSheet);
    const result = runner.run(action, input, sheets);
    sheets.set(action.outputSheet, TransformScriptRunner.rowsToDataSheet(action.outputSheet, result.outputRows));
    console.log(
      `        Rows: ${input.data.length} input, ${result.outputRows.length} output, `
      + `${result.errorRows.length} error(s).`
    );
    if (result.errorRows.length > 0) {
      const rows = action.errorRows === 'all' ? result.allRowsForErrors : result.errorRows;
      sheets.set(action.errorSheet, TransformScriptRunner.rowsToDataSheet(action.errorSheet, rows));
      return true;
    }
    return false;
  }

  private static async executeWrite(
    execConf: ExecConf,
    action: WriteAction,
    sheets: SheetRegistry
  ): Promise<boolean> {
    const input = sheets.require(action.inputSheet);
    const request = this.prepareWriteRequest(action, input);
    const localErrors = request.localErrors;
    let apiResults: WriteRowResult[] = [];

    if (request.request.rows.length > 0) {
      const connection = await this.connection();
      apiResults = await this.loader(execConf).write(
        connection.instanceUrl,
        connection.accessToken,
        request.request
      );
    }
    const results = [...localErrors, ...apiResults].sort((left, right) => left.inputIndex - right.inputIndex);
    const errors = results.filter(result => !result.success);
    console.log(
      `        Rows: ${input.data.length} input, ${request.request.rows.length} submitted, `
      + `${errors.length} error(s).`
    );

    if (action.type === 'insert') {
      this.writeInsertOutput(action as InsertAction, sheets, apiResults);
    }
    if (errors.length > 0) {
      this.writeRowErrorSheet(action, input, results, sheets);
      return true;
    }
    return false;
  }

  private static prepareWriteRequest(
    action: WriteAction,
    input: DataSheet
  ): { request: SalesforceWriteRequest; localErrors: WriteRowResult[] } {
    const operation = action.type as SalesforceWriteRequest['operation'];
    const configuredFields = operation === 'delete'
      ? ['Id']
      : (action as InsertAction | UpdateAction | UpsertAction).fields;
    const fields = configuredFields.length > 0
      ? configuredFields
      : input.fieldNames;
    if (fields.length === 0) {
      throw new Error(`Input sheet "${input.name}" has no fields available for ${operation.toUpperCase()}.`);
    }
    const fieldIndexes = new Map(fields.map(field => [field, input.fieldNames.indexOf(field)]));
    const missingFields = fields.filter(field => fieldIndexes.get(field) === -1);
    if (missingFields.length > 0) {
      throw new Error(`Input sheet "${input.name}" is missing required fields: ${missingFields.join(', ')}.`);
    }

    const idIndex = input.fieldNames.indexOf('Id');
    const externalIdField = operation === 'upsert' ? (action as UpsertAction).externalIdField : undefined;
    const externalIdIndex = externalIdField ? input.fieldNames.indexOf(externalIdField) : -1;
    if ((operation === 'update' || operation === 'delete') && idIndex < 0) {
      throw new Error(`Input sheet "${input.name}" is missing required field: Id.`);
    }
    if (operation === 'upsert' && externalIdIndex < 0) {
      throw new Error(`Input sheet "${input.name}" is missing required field: ${externalIdField}.`);
    }
    const rows: PreparedWriteRow[] = [];
    const localErrors: WriteRowResult[] = [];

    input.data.forEach((values, inputIndex) => {
      let validationError: string | undefined;
      if ((operation === 'update' || operation === 'delete') && !values[idIndex]) {
        validationError = `${operation.toUpperCase()} rows require a non-empty Id.`;
      } else if (operation === 'upsert' && !values[externalIdIndex]) {
        validationError = `UPSERT rows require a non-empty ${externalIdField}.`;
      }
      if (validationError) {
        localErrors.push({ inputIndex, success: false, error: validationError });
        return;
      }
      rows.push({
        inputIndex,
        values: Object.fromEntries(fields.map(field => [field, values[fieldIndexes.get(field)!] ?? ''])),
      });
    });

    return {
      request: {
        operation,
        object: action.object,
        fields,
        externalIdField,
        rows,
      },
      localErrors,
    };
  }

  private static writeInsertOutput(
    action: InsertAction,
    sheets: SheetRegistry,
    results: WriteRowResult[]
  ): void {
    if (!action.outputSheet) return;
    const successful = results.filter(result => result.success && result.id);
    sheets.set(action.outputSheet, {
      name: action.outputSheet,
      fieldNames: ['_InputRow', 'Id'],
      data: successful.map(result => [String(result.inputIndex + 1), result.id!]),
    });
  }

  private static writeRowErrorSheet(
    action: WriteAction,
    input: DataSheet,
    results: WriteRowResult[],
    sheets: SheetRegistry
  ): void {
    const errors = new Map(results.filter(result => !result.success).map(result => [result.inputIndex, result.error ?? 'Unknown error']));
    const rowIndexes = action.errorRows === 'all'
      ? input.data.map((_row, index) => index)
      : Array.from(errors.keys()).sort((left, right) => left - right);
    sheets.set(action.errorSheet, {
      name: action.errorSheet,
      fieldNames: [...input.fieldNames, '_ErrorMessage'],
      data: rowIndexes.map(index => [...input.data[index], errors.get(index) ?? '']),
    });
  }

  private static writeFatalErrorSheet(action: Action, sheets: SheetRegistry, message: string): void {
    let fields: string[] = [];
    if ('inputSheet' in action) {
      fields = sheets.get(String(action.inputSheet))?.fieldNames ?? [];
    }
    sheets.set(action.errorSheet, {
      name: action.errorSheet,
      fieldNames: [...fields, '_ErrorMessage'],
      data: [[...fields.map(() => ''), message]],
    });
  }

  private static loader(execConf: ExecConf): SalesforceDataLoader {
    return execConf.appConfiguration.processingType === 'api'
      || execConf.appConfiguration.processingType === 'sf'
      ? new SalesforceApiLoader(execConf.appConfiguration)
      : new SalesforceBulkApiLoader(execConf.appConfiguration);
  }

  private static async connection(): Promise<{ instanceUrl: string; accessToken: string }> {
    const connection = await SalesforceAuthenticator.authenticate();
    if (!connection?.instanceUrl || !connection.accessToken) {
      throw new Error('Salesforce authentication failed.');
    }
    return { instanceUrl: connection.instanceUrl, accessToken: connection.accessToken };
  }
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function resolveActionRange(
  actions: Array<{ name: string }>,
  fromTask?: string,
  toTask?: string
): ResolvedActionRange {
  if (actions.length === 0) {
    if (fromTask || toTask) {
      throw new Error(
        `Cannot select ${fromTask ? `fromTask "${fromTask}"` : `toTask "${toTask}"`}: the configuration has no actions.`
      );
    }
    return { start: 0, end: -1 };
  }

  const start = fromTask ? findActionIndex(actions, fromTask, 'fromTask') : 0;
  const end = toTask ? findActionIndex(actions, toTask, 'toTask') : actions.length - 1;
  if (start > end) {
    throw new Error(
      `fromTask "${actions[start].name}" (action ${start + 1}) is after `
      + `toTask "${actions[end].name}" (action ${end + 1}).`
    );
  }
  return { start, end };
}

export function describeActionRange(
  actions: Array<{ name: string }>,
  range: ResolvedActionRange
): string {
  if (actions.length === 0 || range.end < range.start) {
    return '0 action(s)';
  }
  if (range.start === 0 && range.end === actions.length - 1) {
    return `${actions.length} action(s) in YAML order`;
  }
  const first = actions[range.start].name;
  const last = actions[range.end].name;
  if (range.start === range.end) {
    return `action ${range.start + 1} of ${actions.length} ("${first}")`;
  }
  return `actions ${range.start + 1}–${range.end + 1} of ${actions.length} ("${first}" through "${last}")`;
}

function findActionIndex(
  actions: Array<{ name: string }>,
  selector: string,
  flagName: 'fromTask' | 'toTask'
): number {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error(`${flagName} must be an action name or a 1-based index.`);
  }

  const byName = actions.findIndex(action => action.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  if (byName >= 0) return byName;

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index < 0 || index >= actions.length) {
      throw new Error(
        `${flagName} index ${trimmed} is out of range. There ${actions.length === 1 ? 'is' : 'are'} `
        + `${actions.length} action(s).`
      );
    }
    return index;
  }

  throw new Error(
    `Unknown ${flagName} "${trimmed}". Available actions: ${actions.map(action => `"${action.name}"`).join(', ')}.`
  );
}

export function isBulkQueryUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /selecting compound data not supported in bulk query/i.test(message);
}
