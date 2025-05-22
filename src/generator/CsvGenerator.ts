import * as fs from 'fs';
import * as path from 'path';
import { CsvProcessor } from '../processor/CsvProcessor';
import { DataSheet } from '../model/DataSheet';

export class CsvGenerator {
  /**
   * Generates CSV files for each DataSheet in the provided sheetsData dictionary.
   * @param sheetsData A dictionary where the key is the sheet name and the value is the DataSheet object.
   * @param outputFolder The folder where the CSV files will be saved.
   */
  static async generateCsvFile(
    dataSheet: DataSheet,
    outputFolder: string,
    fileName: string
  ): Promise<void> {
    try {
      // Ensure the output folder exists
      if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder, { recursive: true });
      }

      // Prepare the headers and data for the CSV
      const csvContent = CsvProcessor.generateCSV(dataSheet.columnNames, dataSheet.data);

      // Define the output file path
      const outputFilePath = path.join(outputFolder, fileName);

      // Write the CSV content to the file
      fs.writeFileSync(outputFilePath, csvContent, 'utf8');
    } catch (error: any) {
      console.error('Error generating CSV files:', error.message);
      throw error;
    }
  }
}