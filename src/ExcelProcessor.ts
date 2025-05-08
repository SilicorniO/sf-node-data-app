import * as XLSX from 'xlsx';
import * as path from 'path';
import { DataSheet } from './model/DataSheet';

export class ExcelProcessor {
  static async readExcelFile(filePath: string, includeFieldNames: boolean = false): Promise<{ [sheetName: string]: DataSheet }> {
    try {
      const workbook = XLSX.readFile(path.resolve(filePath));
      const sheetsData: { [sheetName: string]: DataSheet } = {};

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        const numCols = range.e.c + 1;
        const numRows = range.e.r + 1;
        const startDataRow = includeFieldNames ? 2 : 1;

        if (numRows < (includeFieldNames ? 3 : 2)) {
          console.warn(`Sheet "${sheetName}" is empty or has less than ${includeFieldNames ? 'three' : 'two'} rows and will be skipped.`);
          continue;
        }

        const fieldNames: string[] = [];
        const apiNames: string[] = [];

        for (let C = 0; C < numCols; ++C) {
          const firstRowAddress = XLSX.utils.encode_cell({ r: 0, c: C });
          const secondRowAddress = XLSX.utils.encode_cell({ r: 1, c: C });
          const firstRowValue = worksheet[firstRowAddress]?.v as string || `Column_${C + 1}_Row1`;
          const secondRowValue = worksheet[secondRowAddress]?.v as string || `Column_${C + 1}_Row2`;

          if (includeFieldNames) {
            fieldNames.push(firstRowValue);
            apiNames.push(secondRowValue);
          } else {
            fieldNames.push(firstRowValue);
            apiNames.push(firstRowValue);
          }
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

        sheetsData[sheetName] = {
          name: sheetName,
          fieldNames: fieldNames,
          apiNames: apiNames,
          data: data,
        };
      }

      return sheetsData;
    } catch (error: any) {
      console.error('Error reading Excel file:', error.message);
      throw error;
    }
  }
}
