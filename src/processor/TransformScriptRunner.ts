import { TransformAction } from '../model/TransformAction';
import { CheckAction } from '../model/CheckAction';
import { DataSheet } from '../model/DataSheet';
import { SheetRegistry } from './SheetRegistry';

export type TransformRow = Record<string, string>;
export type TransformFunction = (
  row: TransformRow,
  context: TransformContext
) => TransformRow | null;

export interface TransformContext {
  lookup(sheetName: string, matchField: string, value: string): TransformRow | undefined;
  lookupAll(sheetName: string, matchField: string, value: string): TransformRow[];
}

/**
 * A check function receives its declared input sheets as a map keyed by sheet name
 * and returns whether the check passes. It shares the transform context (lookup /
 * lookupAll) so it can also cross-reference other sheets.
 */
export type CheckFunction = (
  sheets: Record<string, DataSheet>,
  context: TransformContext
) => boolean;

export interface TransformResult {
  outputRows: TransformRow[];
  errorRows: TransformRow[];
  allRowsForErrors: TransformRow[];
}

export class TransformScriptRunner {
  private readonly functions = new Map<string, TransformFunction>();
  private readonly checkFunctions = new Map<string, CheckFunction>();
  // Cache of loaded script modules keyed by absolute file path, shared between the
  // transform and check preflight passes so a single file is required only once.
  private readonly modules = new Map<string, Record<string, unknown>>();

  preflight(actions: TransformAction[]): void {
    for (const action of actions) {
      const fn = this.loadFunction(action.scriptFile, action.name, 'Transform');
      this.functions.set(action.name, fn as TransformFunction);
    }
  }

  preflightChecks(actions: CheckAction[]): void {
    for (const action of actions) {
      const fn = this.loadFunction(action.scriptFile, action.name, 'Check');
      this.checkFunctions.set(action.name, fn as CheckFunction);
    }
  }

  // Loads (once) the script module and returns the function exported under `actionName`.
  private loadFunction(scriptFile: string, actionName: string, kind: 'Transform' | 'Check'): Function {
    let exported = this.modules.get(scriptFile);
    if (!exported) {
      try {
        const loaded = require(scriptFile);
        const resolved = loaded?.default ?? loaded;
        if (!resolved || typeof resolved !== 'object') {
          throw new Error('the module must export an object keyed by action name');
        }
        exported = resolved as Record<string, unknown>;
        this.modules.set(scriptFile, exported);
      } catch (error: any) {
        throw new Error(`Unable to load ${kind.toLowerCase()} script file "${scriptFile}" for action "${actionName}": ${error.message}`);
      }
    }
    const fn = exported[actionName];
    if (typeof fn !== 'function') {
      throw new Error(`${kind} script file "${scriptFile}" does not export a function for action "${actionName}".`);
    }
    return fn as Function;
  }

  /**
   * Runs a check action's function against its declared input sheets.
   * Returns whether the check passed. A non-boolean return value is a fatal error,
   * mirroring the transform runner's strict return contract.
   */
  runCheck(action: CheckAction, sheets: SheetRegistry): boolean {
    const check = this.checkFunctions.get(action.name);
    if (!check) {
      throw new Error(`Check script for action "${action.name}" was not preflighted.`);
    }
    const inputs: Record<string, DataSheet> = {};
    for (const name of action.inputSheets) {
      inputs[name] = sheets.require(name);
    }
    const context = this.createContext(sheets);
    const result = check(inputs, context);
    if (typeof result !== 'boolean') {
      throw new Error(`Check function for action "${action.name}" must return a boolean.`);
    }
    return result;
  }

  run(action: TransformAction, input: DataSheet, sheets: SheetRegistry): TransformResult {
    const transform = this.functions.get(action.name);
    if (!transform) {
      throw new Error(`Transform script for action "${action.name}" was not preflighted.`);
    }

    const context = this.createContext(sheets);
    const outputRows: TransformRow[] = [];
    const errorRows: TransformRow[] = [];
    const allRowsForErrors: TransformRow[] = [];

    for (const sourceValues of input.data) {
      const row = this.toRow(input.fieldNames, sourceValues);
      try {
        const result = transform(row, context);
        if (result !== null && (typeof result !== 'object' || Array.isArray(result))) {
          throw new Error('Transform function must return a row object or null.');
        }
        if (result) {
          const normalized = this.normalizeRow(result);
          outputRows.push(normalized);
          allRowsForErrors.push({ ...normalized, _ErrorMessage: '' });
        }
      } catch (error: any) {
        const failed = { ...this.normalizeRow(row), _ErrorMessage: error.message };
        errorRows.push(failed);
        allRowsForErrors.push(failed);
      }
    }

    return { outputRows, errorRows, allRowsForErrors };
  }

  /**
   * Builds a sheet from transform rows. Column headers are the union of the rows'
   * keys, in first-seen order. When there are no rows, `fallbackFieldNames` (e.g. the
   * transform's input headers) are used so the output sheet still carries a schema —
   * downstream scripts and CSVs then see the columns even with zero rows.
   */
  static rowsToDataSheet(name: string, rows: TransformRow[], fallbackFieldNames: string[] = []): DataSheet {
    const fieldNames: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const field of Object.keys(row)) {
        if (!seen.has(field)) {
          seen.add(field);
          fieldNames.push(field);
        }
      }
    }
    if (fieldNames.length === 0) {
      fieldNames.push(...fallbackFieldNames);
    }
    return {
      name,
      fieldNames,
      data: rows.map(row => fieldNames.map(field => row[field] ?? '')),
    };
  }

  private createContext(sheets: SheetRegistry): TransformContext {
    const lookupAll = (sheetName: string, matchField: string, value: string): TransformRow[] => {
      const sheet = sheets.require(sheetName);
      const fieldIndex = sheet.fieldNames.indexOf(matchField);
      if (fieldIndex < 0) {
        throw new Error(`Field "${matchField}" was not found in sheet "${sheet.name}".`);
      }
      return sheet.data
        .filter(row => row[fieldIndex] === value)
        .map(row => this.toRow(sheet.fieldNames, row));
    };
    return {
      lookup: (sheetName, matchField, value) => lookupAll(sheetName, matchField, value)[0],
      lookupAll,
    };
  }

  private toRow(fieldNames: string[], values: string[]): TransformRow {
    return Object.fromEntries(fieldNames.map((field, index) => [field, values[index] ?? '']));
  }

  private normalizeRow(row: Record<string, unknown>): TransformRow {
    return Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, value == null ? '' : String(value)])
    );
  }
}
