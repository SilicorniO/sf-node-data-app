import * as XLSX from 'xlsx';
import * as path from 'path';
import { DataSheet } from '../model/DataSheet';

export class ExcelGenerator {
  /**
   * Converts a map of DataSheet objects into an Excel file with multiple sheets and saves it to the specified path.
   * @param sheetsData A map where the key is the sheet name and the value is the DataSheet object.
   * @param filePath The path where the Excel file will be saved.
   * @param includeHeaderNames Whether to include field names and API names in the Excel file.
   */
  static async generateExcelFile(
    sheetsData: { [sheetName: string]: DataSheet },
    filePath: string,
    includeHeaderNames: boolean = false,
  ): Promise<void> {
    try {
      // Create a new workbook
      const workbook = XLSX.utils.book_new();

      // Iterate through each DataSheet in the map and create a worksheet
      for (const sheetName in sheetsData) {
        if (sheetsData.hasOwnProperty(sheetName)) {
          const dataSheet = sheetsData[sheetName];
          const worksheetData: (string | undefined)[][] = [];

          // Add field names as the first row if includeHeaderNames is true
          if (includeHeaderNames) {
            worksheetData.push(dataSheet.headerNames);
          }

          // Add API names
          worksheetData.push(dataSheet.columnNames);

          // Add the data rows
          worksheetData.push(...dataSheet.data);

          // Create a worksheet from the data
          const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

          // Append the worksheet to the workbook
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        }
      }

      // Resolve the file path and write the workbook to the file
      const resolvedPath = path.resolve(filePath);
      XLSX.writeFile(workbook, resolvedPath);

      console.log(`Excel file successfully generated at: ${resolvedPath}`);
    } catch (error: any) {
      console.error('Error generating Excel file:', error.message);
      throw error;
    }
  }
}