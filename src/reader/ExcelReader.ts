import * as XLSX from 'xlsx';
import * as path from 'path';
import { DataSheet } from '../model/DataSheet';

export class ExcelReader {
  static async readExcelFile(filePath: string): Promise<{ [sheetName: string]: DataSheet }> {
    try {
      const workbook = XLSX.readFile(path.resolve(filePath));
      const sheetsData: { [sheetName: string]: DataSheet } = {};
      const normalizedNames = new Map<string, string>();

      for (const sheetName of workbook.SheetNames) {
        const normalizedName = sheetName.toLocaleLowerCase();
        if (normalizedNames.has(normalizedName)) {
          throw new Error(`Duplicate Excel sheet names differ only by case: "${normalizedNames.get(normalizedName)}" and "${sheetName}".`);
        }
        normalizedNames.set(normalizedName, sheetName);
        const sheet = this.parseWorksheet(workbook, sheetName);
        if (sheet) {
          sheetsData[sheetName] = sheet;
        }
      }

      return sheetsData;
    } catch (error: any) {
      console.error('Error reading Excel file:', error.message);
      throw error;
    }
  }

  /** Returns the worksheet names in a workbook without materializing their rows. */
  static listSheetNames(filePath: string): string[] {
    const workbook = XLSX.readFile(path.resolve(filePath), { sheetRows: 0, bookSheets: true });
    return [...workbook.SheetNames];
  }

  /**
   * Reads a single worksheet from a workbook. The workbook is parsed to extract
   * the requested sheet and then released, so only that sheet's rows are retained.
   */
  static async readWorksheet(filePath: string, sheetName: string): Promise<DataSheet> {
    return this.readWorksheetSync(filePath, sheetName);
  }

  /** Synchronous read of a single worksheet, used to reload a released sheet on demand. */
  static readWorksheetSync(filePath: string, sheetName: string): DataSheet {
    const workbook = XLSX.readFile(path.resolve(filePath), { sheets: [sheetName] });
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Worksheet "${sheetName}" was not found in Excel file "${filePath}".`);
    }
    const sheet = this.parseWorksheet(workbook, sheetName);
    if (!sheet) {
      return { name: sheetName, fieldNames: [], data: [] };
    }
    return sheet;
  }

  private static parseWorksheet(workbook: XLSX.WorkBook, sheetName: string): DataSheet | undefined {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const numCols = range.e.c + 1;
    const numRows = range.e.r + 1;
    const startDataRow = 1;

    if (numRows < 2) {
      console.warn(`        - SKIP "${sheetName}": empty or has no data rows.`);
      return undefined;
    }

    const fieldNames: string[] = [];

    for (let C = 0; C < numCols; ++C) {
      const firstRowAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      const firstRowValue = worksheet[firstRowAddress]?.v as string || '';
      fieldNames.push(firstRowValue);
    }

    const data: string[][] = [];
    let hasData = true;
    for (let R = startDataRow; R < numRows && hasData; ++R) {
      const rowData: string[] = [];
      hasData = false;
      for (let C = 0; C < numCols; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        const cellValue = worksheet[cellAddress]?.v;
        rowData.push(cellValue !== undefined && cellValue !== null ? String(cellValue) : '');
        if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
          hasData = true;
        }
      }
      if (hasData) {
        data.push(rowData);
      } else {
        break;
      }
    }

    return {
      name: sheetName,
      fieldNames: fieldNames,
      data: data,
    };
  }
}
