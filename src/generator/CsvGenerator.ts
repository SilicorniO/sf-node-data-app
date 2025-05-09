import * as fs from 'fs';
import * as path from 'path';
import { CsvProcessor } from '../processor/CsvProcessor';
import { DataSheet } from '../model/DataSheet';

export class CsvGenerator {
  /**
   * Generates CSV files for each DataSheet in the provided sheetsData dictionary.
   * @param sheetsData A dictionary where the key is the sheet name and the value is the DataSheet object.
   * @param outputFolder The folder where the CSV files will be saved.
   * @param includeFieldNames Whether to include field names as the first row in the CSV files.
   */
  static async generateCsvFiles(
    sheetsData: { [sheetName: string]: DataSheet },
    outputFolder: string
  ): Promise<void> {
    try {
      // Ensure the output folder exists
      if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder, { recursive: true });
      }

      // Iterate through each DataSheet in the map and generate a CSV file
      for (const sheetName in sheetsData) {
        if (sheetsData.hasOwnProperty(sheetName)) {
          const dataSheet = sheetsData[sheetName];

          // Prepare the headers and data for the CSV
          const csvContent = CsvProcessor.generateCSV(dataSheet.apiNames, dataSheet.data);

          // Define the output file path
          const outputFilePath = path.join(outputFolder, `${sheetName}_output.csv`);

          // Write the CSV content to the file
          fs.writeFileSync(outputFilePath, csvContent, 'utf8');
          console.log(`CSV file successfully generated for sheet "${sheetName}" at: ${outputFilePath}`);
        }
      }
    } catch (error: any) {
      console.error('Error generating CSV files:', error.message);
      throw error;
    }
  }
}