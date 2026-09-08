import { Action } from '../model/Action';
import { DataSheet } from '../model/DataSheet';
import { DeleteAction } from '../model/DeleteAction';
import { ExecConf } from '../model/ExecConf';
import { GetAction } from '../model/GetAction';
import { InsertAction } from '../model/InsertAction';
import { MergeAction } from '../model/MergeAction';
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

export interface ProcessActionsOptions extends ActionExecutionRange {
  /**
   * Invoked as soon as an action produces or updates a sheet, so it can be
   * streamed to disk and released from memory instead of accumulating.
   */
  onSheetProduced?: (name: string, sheet: DataSheet) => Promise<void> | void;
}

/** Static sheet references an action reads as input (excludes dynamic transform lookups). */
function actionInputSheets(action: Action): string[] {
  switch (action.type) {
    case 'transform':
      return [(action as TransformAction).inputSheet];
    case 'merge':
      return [(action as MergeAction).primarySheet, (action as MergeAction).secondarySheet];
    case 'insert':
    case 'update':
    case 'upsert':
    case 'delete':
      return [(action as WriteAction).inputSheet];
    case 'get':
    default:
      return [];
  }
}

/** Sheet an action writes as its primary output, if any. */
function actionOutputSheet(action: Action): string | undefined {
  switch (action.type) {
    case 'get':
      return (action as GetAction).outputSheet;
    case 'transform':
      return (action as TransformAction).outputSheet;
    case 'merge':
      return (action as MergeAction).outputSheet;
    case 'insert':
      return (action as InsertAction).outputSheet;
    default:
      return undefined;
  }
}

/**
 * For each statically-referenced input sheet, the last selected action index that
 * reads it. A sheet can be released once execution passes its last-use index.
 */
function computeLastInputUse(actions: Action[], start: number, end: number): Map<string, number> {
  const lastUse = new Map<string, number>();
  for (let index = start; index <= end; index++) {
    for (const sheet of actionInputSheets(actions[index])) {
      lastUse.set(sheet.toLocaleLowerCase(), index);
    }
  }
  return lastUse;
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
    executionRange: ProcessActionsOptions = {}
  ): Promise<PipelineResult> {
    const registry = sheetsInput instanceof SheetRegistry ? sheetsInput : new SheetRegistry(sheetsInput);
    const externalSheets = sheetsInput instanceof SheetRegistry ? undefined : sheetsInput;
    const onSheetProduced = executionRange.onSheetProduced;
    const transformRunner = new TransformScriptRunner();
    try {
      let range: ResolvedActionRange;
      try {
        range = resolveActionRange(execConf.actions, executionRange.fromTask, executionRange.toTask);
      } catch (error: any) {
        throw new ConfigurationPreflightError(error.message);
      }
      const selectedActions = range.end < range.start ? [] : execConf.actions.slice(range.start, range.end + 1);
      const lastInputUse = computeLastInputUse(execConf.actions, range.start, range.end);
      // Transforms can read any sheet dynamically via context.lookup, which is not
      // statically visible. In-memory-only sheets (no file loader to reload from) are
      // therefore kept until the last transform in range has run.
      let lastTransformIndex = -1;
      for (let index = range.start; index <= range.end; index++) {
        if (execConf.actions[index].type === 'transform') lastTransformIndex = index;
      }

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

        // Load only the input sheets this action needs, on demand.
        for (const inputSheet of actionInputSheets(action)) {
          if (registry.isKnown(inputSheet)) {
            await registry.load(inputSheet);
          }
        }

        let hadRowErrors: boolean;
        try {
          hadRowErrors = await this.executeAction(execConf, action, registry, transformRunner);
        } catch (error) {
          console.error(
            `      [${index + 1}/${execConf.actions.length}] ${action.type.toUpperCase()} `
            + `"${action.name}" — failed after ${formatDuration(Date.now() - startedAt)}`
          );
          // Stream out any error sheet produced by the failure before propagating.
          await this.flushAndRelease(registry, action, index, lastInputUse, lastTransformIndex, onSheetProduced);
          throw error;
        }
        await this.flushAndRelease(registry, action, index, lastInputUse, lastTransformIndex, onSheetProduced);
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

  /**
   * Streams the sheets an action produced (its output and error sheets) to disk via
   * the callback, then releases from memory every sheet no later action reads. Input
   * sheets backed by a file loader can be reloaded on demand if needed again.
   */
  private static async flushAndRelease(
    sheets: SheetRegistry,
    action: Action,
    index: number,
    lastInputUse: Map<string, number>,
    lastTransformIndex: number,
    onSheetProduced?: (name: string, sheet: DataSheet) => Promise<void> | void
  ): Promise<void> {
    // Streaming/release is a memory-bounded mode enabled only when a sink is provided
    // (the CLI). Without it, callers keep every sheet in the registry (legacy behavior).
    if (!onSheetProduced) {
      return;
    }

    const produced = new Set<string>();
    const outputSheet = actionOutputSheet(action);
    if (outputSheet) produced.add(outputSheet);
    produced.add(action.errorSheet);

    // Stream produced sheets to disk as soon as they exist.
    for (const name of produced) {
      const sheet = sheets.get(name);
      if (sheet) {
        await onSheetProduced(name, sheet);
      }
    }

    // Release in-memory sheets no later action reads as a static input. A sheet with a
    // file loader can always be reloaded, so it is freed as soon as its static uses are
    // done. A produced (loader-less) sheet may still be read by a later transform's
    // dynamic lookup, so it is kept until the last transform in range has run.
    for (const name of sheets.loadedNames()) {
      const lastUse = lastInputUse.get(name.toLocaleLowerCase());
      const staticallyDone = lastUse === undefined || lastUse <= index;
      if (!staticallyDone) {
        continue;
      }
      if (!sheets.isReloadable(name) && index < lastTransformIndex) {
        continue;
      }
      sheets.release(name);
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
        case 'merge':
          this.executeMerge(action as MergeAction, sheets);
          return false;
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
    if (execConf.appConfiguration.processingType === 'api') {
      result = await new SalesforceApiLoader(execConf.appConfiguration).query(
        connection.instanceUrl,
        connection.accessToken,
        action.query,
        action.outputSheet
      );
    } else {
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
    // Fall back to the input headers when the transform emits no rows, so the output
    // sheet still exposes a schema for downstream scripts and CSV output.
    sheets.set(
      action.outputSheet,
      TransformScriptRunner.rowsToDataSheet(action.outputSheet, result.outputRows, input.fieldNames)
    );
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

  private static executeMerge(action: MergeAction, sheets: SheetRegistry): void {
    const primary = sheets.require(action.primarySheet);
    const secondary = sheets.require(action.secondarySheet);

    const primaryIdIndex = primary.fieldNames.indexOf(action.idField);
    if (primaryIdIndex < 0) {
      throw new Error(`Sheet "${primary.name}" is missing required field: ${action.idField}.`);
    }
    const secondaryIdIndex = secondary.fieldNames.indexOf(action.idField);
    if (secondaryIdIndex < 0) {
      throw new Error(`Sheet "${secondary.name}" is missing required field: ${action.idField}.`);
    }

    // Output columns: all primary columns (in order), then secondary columns not already present.
    const fieldNames = [...primary.fieldNames];
    const fieldIndex = new Map(fieldNames.map((field, index) => [field.toLocaleLowerCase(), index]));
    const secondaryToOutput = secondary.fieldNames.map(field => {
      const key = field.toLocaleLowerCase();
      let index = fieldIndex.get(key);
      if (index === undefined) {
        index = fieldNames.length;
        fieldNames.push(field);
        fieldIndex.set(key, index);
      }
      return index;
    });

    const blankRow = (): string[] => fieldNames.map(() => '');
    const data: string[][] = [];

    // Primary rows: matched (non-empty id) rows are indexed for merging; empty-id rows pass through.
    const rowById = new Map<string, string[]>();
    primary.data.forEach(values => {
      const id = values[primaryIdIndex] ?? '';
      const row = blankRow();
      primary.fieldNames.forEach((_field, column) => { row[column] = values[column] ?? ''; });
      if (id === '') {
        data.push(row);
        return;
      }
      if (rowById.has(id)) {
        throw new Error(`Sheet "${primary.name}" has a duplicate ${action.idField} value: "${id}".`);
      }
      rowById.set(id, row);
      data.push(row);
    });

    // Secondary rows: merge into the matching primary row (primary wins non-empty cells);
    // unmatched non-empty ids append a new row; empty-id rows pass through.
    const seenSecondaryIds = new Set<string>();
    secondary.data.forEach(values => {
      const id = values[secondaryIdIndex] ?? '';
      if (id === '') {
        const row = blankRow();
        secondary.fieldNames.forEach((_field, column) => { row[secondaryToOutput[column]] = values[column] ?? ''; });
        data.push(row);
        return;
      }
      if (seenSecondaryIds.has(id)) {
        throw new Error(`Sheet "${secondary.name}" has a duplicate ${action.idField} value: "${id}".`);
      }
      seenSecondaryIds.add(id);
      const existing = rowById.get(id);
      if (existing) {
        secondary.fieldNames.forEach((_field, column) => {
          const output = secondaryToOutput[column];
          if (existing[output] === '') existing[output] = values[column] ?? '';
        });
        return;
      }
      const row = blankRow();
      secondary.fieldNames.forEach((_field, column) => { row[secondaryToOutput[column]] = values[column] ?? ''; });
      data.push(row);
    });

    sheets.set(action.outputSheet, { name: action.outputSheet, fieldNames, data });
    console.log(`        Output "${action.outputSheet}": ${data.length} row(s).`);
  }

  private static async executeWrite(
    execConf: ExecConf,
    action: WriteAction,
    sheets: SheetRegistry
  ): Promise<boolean> {
    const input = sheets.require(action.inputSheet);
    // An empty input sheet is a no-op, not an error: there is nothing to submit,
    // so downstream write actions should simply skip (0 rows, 0 errors) and let
    // the pipeline continue.
    if (input.data.length === 0) {
      console.log(`        Rows: 0 input, 0 submitted, 0 error(s).`);
      if (action.type === 'insert') {
        this.writeInsertOutput(action as InsertAction, sheets, []);
      }
      return false;
    }
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
        values: Object.fromEntries(fields.map(field => {
          const value = values[fieldIndexes.get(field)!] ?? '';
          // Send null (not "") for empty cells so the JSON REST API accepts typed
          // fields such as date/datetime; the CSV Bulk path coerces null back to "".
          return [field, value === '' ? null : value];
        })),
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
