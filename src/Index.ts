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


async function main() {
  // Load environment variables from .env file
  dotenv.config();

  const program = new Command();
  program
    .requiredOption('-c, --confFile <path>', 'Path to the JSON configuration file')
    .option('-e, --excelFile <path>', 'Path to the Excel file')
    .option('-o, --outputFolder <path>', 'Path to the folder where output files will be created') // New parameter
    .option('-h, --includeHeaderNames', 'Indicates that the Excel file has a header row with field names', false)
    .option('-v, --csvFiles <paths...>', 'Paths to the CSV files') // New parameter for CSV files
    .parse(process.argv);

  const excelFilePath = program.opts().excelFile;
  const confFilePath = program.opts().confFile;
  const outputFolder = program.opts().outputFolder || './'; // Default to current directory if not provided
  const includeHeaderNames = program.opts().includeHeaderNames;
  const csvFiles = program.opts().csvFiles || []; // Get the CSV file paths

  try {
    // Read data
    const execConf = ExecConfReader.readConfFile(confFilePath);

    let excelSheetsData: {[sheetName: string]: DataSheet} = {} 
    let csvSheetsData: {[sheetName: string]: DataSheet} = {} 
    let sheetsData: {[sheetName: string]: DataSheet} = {} 
    if (excelFilePath != null) {
      excelSheetsData = {...sheetsData, ...await ExcelReader.readExcelFile(excelFilePath, includeHeaderNames)};
    }
    if (csvFiles.length > 0) {
      csvSheetsData = await CsvReader.readCsvFiles(csvFiles);
    }
    sheetsData = {...excelSheetsData, ...csvSheetsData}; // Merge CSV data with existing data

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
      await ExcelGenerator.generateExcelFile(
        excelSheetsData,
        outputFolder + '/import_results.xlsx', // Specify the output file name
        includeHeaderNames
      );
    }

    // generate output csvs
    try {
      await CsvGenerator.generateCsvFiles(csvSheetsData, outputFolder);
    } catch (error: any) {
      console.error('Error:', error.message);
    } 

  } catch (error) {
    console.error('Failed to process files:', error);
    process.exit(1);
  }
}

main();
