import * as fs from 'fs';
import * as path from 'path';
import { CsvProcessor } from '../processor/CsvProcessor';
import { DataSheet } from '../model/DataSheet';

export class CsvReader {
  /**
   * Reads multiple CSV files and returns a dictionary of DataSheet objects.
   * @param csvFilePaths An array of paths to the CSV files.
   * @returns A promise that resolves to a dictionary of DataSheet objects.
   */
  static async readCsvFiles(csvFilePaths: string[]): Promise<{ [sheetName: string]: DataSheet }> {
    const sheetsData: { [sheetName: string]: DataSheet } = {};

    for (const filePath of csvFilePaths) {
      const sheetName = path.basename(filePath, path.extname(filePath)); // Use the file name (without extension) as the sheet name
      const dataSheet = await this.readCsvFile(filePath);
      sheetsData[sheetName] = dataSheet;
    }

    return sheetsData;
  }

  /**
   * Reads a single CSV file and returns a DataSheet object.
   * @param filePath The path to the CSV file.
   * @returns A promise that resolves to a DataSheet object.
   */
  private static async readCsvFile(filePath: string): Promise<DataSheet> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, csvString) => {
        if (err) {
          return reject(new Error(`Error reading CSV file "${filePath}": ${err.message}`));
        }

        try {
          const { headers, data } = CsvProcessor.parseCSV(csvString);

          const headerNames = [...headers];

          resolve({
            name: path.basename(filePath, path.extname(filePath)),
            columnNames: headerNames,
            headerNames: [...headers],
            data: data,
          });
        } catch (error: any) {
          reject(new Error(`Error parsing CSV file "${filePath}": ${error.message}`));
        }
      });
    });
  }
}