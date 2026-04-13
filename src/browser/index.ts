/**
 * Browser entry point for sfdata.
 *
 * This module exposes the full sfdata pipeline for use in a browser context.
 * It has no Node.js dependencies (no fs, path, dotenv, or jsforce).
 *
 * Quickstart
 * ----------
 * import * as SfData from './sfdata.js';
 *
 * // 1. Parse YAML config (loaded as a string via fetch or textarea)
 * const conf = SfData.parseConf(yamlString);
 *
 * // 2. Load CSV files (via FileReader / fetch / drag-drop)
 * const sheets = {};
 * sheets['accounts'] = SfData.parseCsv(csvString, 'accounts');
 *
 * // 3. Or load an Excel file (via FileReader as ArrayBuffer)
 * Object.assign(sheets, SfData.parseExcel(arrayBuffer));
 *
 * // 4. Set Salesforce credentials
 * SfData.SalesforceAuthenticator.setBearerTokenParams(accessToken, instanceUrl);
 * // or: SfData.SalesforceAuthenticator.setClientCredentialsParams(clientId, secret, url);
 *
 * // 5. Run the pipeline
 * await SfData.ActionProcessor.processActions(conf, sheets);
 *
 * // 6. Export results as CSV strings
 * const csvText = SfData.toCsv(sheets['accounts']);
 */

import * as XLSX from 'xlsx';
import { CsvProcessor }          from '../processor/CsvProcessor';
import { DataSheet }             from '../model/DataSheet';
import { ExecConf }              from '../model/ExecConf';
import { ExecConfReader }        from '../reader/ExecConfReader';

// ── Re-exports ──────────────────────────────────────────────────────────────

export { ActionProcessor }        from '../processor/ActionProcessor';
export { DataSheetProcessor }     from '../processor/DataSheetProcessor';
export { CsvProcessor }           from '../processor/CsvProcessor';
export { SalesforceAuthenticator } from '../salesforce/SalesforceAuthenticator';

// Types
export type { DataSheet }         from '../model/DataSheet';
export type { ExecConf }          from '../model/ExecConf';
export type { AppConfiguration }  from '../model/AppConfiguration';
export type { Action }            from '../model/Action';

// ── Config parsing ───────────────────────────────────────────────────────────

/**
 * Parse a YAML configuration string into an ExecConf object.
 *
 * @example
 * const conf = parseConf(yamlString);
 */
export function parseConf(yamlString: string): ExecConf {
  return ExecConfReader.parseConf(yamlString);
}

// ── CSV helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into a DataSheet.
 *
 * @param csvString  Raw CSV text (first row = headers).
 * @param sheetName  Name to assign to the resulting DataSheet.
 *
 * @example
 * const sheet = parseCsv(csvString, 'accounts');
 */
export function parseCsv(csvString: string, sheetName: string): DataSheet {
  const { headers, data } = CsvProcessor.parseCSV(csvString);
  return { name: sheetName, fieldNames: headers, data };
}

/**
 * Serialize a DataSheet back to a CSV string.
 *
 * @example
 * const blob = new Blob([toCsv(sheet)], { type: 'text/csv' });
 */
export function toCsv(sheet: DataSheet): string {
  return CsvProcessor.generateCSV(sheet.fieldNames, sheet.data);
}

// ── Excel helpers ─────────────────────────────────────────────────────────────

/**
 * Parse an Excel file (as an ArrayBuffer) into a map of DataSheets,
 * one per worksheet tab.
 *
 * Typical usage with the File API:
 * @example
 * const buffer = await file.arrayBuffer();
 * const sheets = parseExcel(buffer);
 *
 * @param arrayBuffer  Raw Excel file bytes (e.g. from FileReader.readAsArrayBuffer).
 */
export function parseExcel(arrayBuffer: ArrayBuffer): { [sheetName: string]: DataSheet } {
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheetsData: { [sheetName: string]: DataSheet } = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const range     = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const numCols   = range.e.c + 1;
    const numRows   = range.e.r + 1;

    if (numRows < 2) continue;

    const fieldNames: string[] = [];
    for (let C = 0; C < numCols; C++) {
      const addr  = XLSX.utils.encode_cell({ r: 0, c: C });
      fieldNames.push((worksheet[addr]?.v as string) || '');
    }

    const data: string[][] = [];
    for (let R = 1; R < numRows; R++) {
      const row: string[] = [];
      let hasData = false;
      for (let C = 0; C < numCols; C++) {
        const addr  = XLSX.utils.encode_cell({ r: R, c: C });
        const val   = worksheet[addr]?.v;
        const str   = val !== undefined && val !== null ? String(val) : '';
        row.push(str);
        if (str !== '') hasData = true;
      }
      if (!hasData) break;
      data.push(row);
    }

    sheetsData[sheetName] = { name: sheetName, fieldNames, data };
  }

  return sheetsData;
}
