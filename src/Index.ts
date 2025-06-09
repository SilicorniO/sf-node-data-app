// src/Index.ts
import { DataSheet } from './model/DataSheet';
import { Command } from 'commander';
import { ExecConfReader } from './reader/ExecConfReader';
import { SalesforceAuthenticator } from './salesforce/SalesforceAuthenticator';
import { ExcelReader } from './reader/ExcelReader';
import * as dotenv from 'dotenv';
import { ExcelGenerator } from './generator/ExcelGenerator';
import { CsvReader } from './reader/CsvReader';
import { CsvGenerator } from './generator/CsvGenerator';
import { ActionProcessor } from './processor/ActionProcessor';

const EXCEL_FILE_SUFFIX = '_results.xlsx';
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

    // processactions
    await ActionProcessor.processActions(execConf.actions, sheetsData, execConf);

    // generate excelfile
    if (excelFilePath != null) {
      // filter sheetsData in excelSheetsData
      const filteredExcelSheetsData: {[sheetName: string]: DataSheet} = {};
      for (const sheetName of Object.keys(excelSheetsData)) {
        filteredExcelSheetsData[sheetName] = sheetsData[sheetName];
      }

      // get the excel file name from the excelFilePath
      const excelFileName = excelFilePath.split('/').pop() || 'import';
      const excelFileNameWithoutExtension = excelFileName.split('.').slice(0, -1).join('.') + EXCEL_FILE_SUFFIX;
      const excelFilePathWithoutExtension = outputFolder + '/' + excelFileNameWithoutExtension;

      // Generate Excel file for the sheetsData
      console.log(`Generating Excel file '${excelFileNameWithoutExtension}'`);
      await ExcelGenerator.generateExcelFile(
        filteredExcelSheetsData,
        excelFilePathWithoutExtension
      );
    }

    // generate output csvs
    try {
      // filter sheetsData in csvSheetsData
      const filteredCsvSheetsData: {[sheetName: string]: DataSheet} = {};
      for (const sheetName of Object.keys(csvSheetsData)) {
        filteredCsvSheetsData[sheetName] = sheetsData[sheetName];
      }

      // inclide missing sheets
      const missingSheets = Object.keys(sheetsData).filter(sheetName => !excelSheetsData[sheetName] && !csvSheetsData[sheetName]);
      if (missingSheets.length > 0) {
        // convert missingSheets to dictionary
        for (const sheetName of missingSheets) {
          filteredCsvSheetsData[sheetName] = sheetsData[sheetName];
        }
      }

      // Generate CSV files for the sheetsData
      for (const sheetName in filteredCsvSheetsData) {
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
