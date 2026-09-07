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
    const normalizedNames = new Map<string, string>();

    for (const filePath of csvFilePaths) {
      const sheetName = path.basename(filePath, path.extname(filePath)); // Use the file name (without extension) as the sheet name
      const normalizedName = sheetName.toLocaleLowerCase();
      if (normalizedNames.has(normalizedName)) {
        throw new Error(`Duplicate CSV sheet names differ only by case: "${normalizedNames.get(normalizedName)}" and "${sheetName}".`);
      }
      normalizedNames.set(normalizedName, sheetName);
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
  static async readCsvFile(filePath: string): Promise<DataSheet> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, csvString) => {
        if (err) {
          return reject(new Error(`Error reading CSV file "${filePath}": ${err.message}`));
        }

        try {
          const { headers, data } = CsvProcessor.parseCSV(csvString);
          const fieldNames = [...headers];

          resolve({
            name: path.basename(filePath, path.extname(filePath)),
            fieldNames: fieldNames,
            data: data,
          });
        } catch (error: any) {
          reject(new Error(`Error parsing CSV file "${filePath}": ${error.message}`));
        }
      });
    });
  }

  /** Synchronous read of a single CSV file, used to reload a released sheet on demand. */
  static readCsvFileSync(filePath: string): DataSheet {
    let csvString: string;
    try {
      csvString = fs.readFileSync(filePath, 'utf8');
    } catch (error: any) {
      throw new Error(`Error reading CSV file "${filePath}": ${error.message}`);
    }
    try {
      const { headers, data } = CsvProcessor.parseCSV(csvString);
      return {
        name: path.basename(filePath, path.extname(filePath)),
        fieldNames: [...headers],
        data,
      };
    } catch (error: any) {
      throw new Error(`Error parsing CSV file "${filePath}": ${error.message}`);
    }
  }
}