// src/Index.ts
import { DataSheet } from './model/DataSheet';
import { Command } from 'commander';
import { ExecConfReader } from './reader/ExecConfReader';
import { SalesforceAuthenticator } from './salesforce/SalesforceAuthenticator';
import { ExcelReader } from './reader/ExcelReader';
import * as dotenv from 'dotenv';
import { CsvReader } from './reader/CsvReader';
import { CsvGenerator } from './generator/CsvGenerator';
import { ActionProcessor } from './processor/ActionProcessor';
import { DataSheetProcessor } from './processor/DataSheetProcessor';

const CSV_FILE_SUFFIX = '_results.csv';

async function main() {
  // Load environment variables from .env file
  dotenv.config();

  const program = new Command();
  program
    .requiredOption('-c, --confFile <path>', 'Path to the JSON configuration file')
    .option('-e, --excelFile <path>', 'Path to the Excel file')
    .option('-o, --outputFolder <path>', 'Path to the folder where output files will be created') // New parameter
    .option('-v, --csvFiles <paths...>', 'Paths to the CSV files') // New parameter for CSV files
    .parse(process.argv);

  const excelFilePath = program.opts().excelFile;
  const confFilePath = program.opts().confFile;
  const outputFolder = program.opts().outputFolder || './'; // Default to current directory if not provided
  const csvFiles = program.opts().csvFiles || []; // Get the CSV file paths

  try {
    // Read data
    const execConf = ExecConfReader.readConfFile(confFilePath);

    let excelSheetsData: {[sheetName: string]: DataSheet} = {} 
    let csvSheetsData: {[sheetName: string]: DataSheet} = {}  
    if (excelFilePath != null) {
      excelSheetsData = await ExcelReader.readExcelFile(excelFilePath);
    }
    if (csvFiles.length > 0) {
      csvSheetsData = await CsvReader.readCsvFiles(csvFiles);
    }
    let sheetsData = {...excelSheetsData, ...csvSheetsData};

    // Set Salesforce authentication parameters
    SalesforceAuthenticator.setAuthParams(
      process.env.SF_CLIENT_ID!,  // Use environment variables
      process.env.SF_CLIENT_SECRET!,
      process.env.SF_INSTANCE_URL!
    );

    // --- Translate field names to apiNames using SheetConf ---
    for (const sheetConf of execConf.sheets) {
      const sheet = sheetsData[sheetConf.name];
      if (sheet != null) {
        DataSheetProcessor.translateFieldNamesToApiNames(sheet, sheetConf.fields);
      }
    }

    // processactions
    await ActionProcessor.processActions(execConf, sheetsData);

    // --- Translate field names from apiNames back to names using SheetConf ---
    for (const sheetConf of execConf.sheets) {
      const sheet = sheetsData[sheetConf.name];
      if (sheet != null) {
        DataSheetProcessor.translateApiNamesToFieldNames(sheet, sheetConf.fields);
      }
    }

    // generate output csvs
    try {

      // Generate CSV files for the sheetsData
      console.log('Object.keys(sheetsData)', Object.keys(sheetsData));
      for (const sheetName of Object.keys(sheetsData)) {
        console.log(`Generating CSV file ${sheetName}${CSV_FILE_SUFFIX}`);
        await CsvGenerator.generateCsvFile(sheetsData[sheetName], outputFolder, `${sheetName}${CSV_FILE_SUFFIX}`);
      }
    } catch (error: any) {
      console.error('Error:', error.message);
    }

    console.log('All actions completed successfully.');

  } catch (error) {
    console.error('Failed to process files:', error);
    process.exit(1);
  }
}

main();
