import { TransformAction } from '../model/TransformAction';
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

export interface TransformResult {
  outputRows: TransformRow[];
  errorRows: TransformRow[];
  allRowsForErrors: TransformRow[];
}

export class TransformScriptRunner {
  private readonly functions = new Map<string, TransformFunction>();

  preflight(actions: TransformAction[]): void {
    const modules = new Map<string, Record<string, unknown>>();
    for (const action of actions) {
      let exported = modules.get(action.scriptFile);
      if (!exported) {
        try {
          const loaded = require(action.scriptFile);
          const resolved = loaded?.default ?? loaded;
          if (!resolved || typeof resolved !== 'object') {
            throw new Error('the module must export an object keyed by action name');
          }
          exported = resolved as Record<string, unknown>;
          modules.set(action.scriptFile, exported);
        } catch (error: any) {
          throw new Error(`Unable to load transform script file "${action.scriptFile}" for action "${action.name}": ${error.message}`);
        }
      }
      const transform = exported[action.name];
      if (typeof transform !== 'function') {
        throw new Error(`Transform script file "${action.scriptFile}" does not export a function for action "${action.name}".`);
      }
      this.functions.set(action.name, transform as TransformFunction);
    }
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

  static rowsToDataSheet(name: string, rows: TransformRow[]): DataSheet {
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
