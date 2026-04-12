#!/usr/bin/env node

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

const CSV_FILE_SUFFIX = '.csv';

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

    // Set Salesforce authentication parameters.
    // Priority: Bearer Token (SF_ACCESS_TOKEN) > Client Credentials (SF_CLIENT_ID + SF_CLIENT_SECRET)
    if (process.env.SF_ACCESS_TOKEN) {
      if (!process.env.SF_INSTANCE_URL) {
        throw new Error('SF_INSTANCE_URL is required when using SF_ACCESS_TOKEN.');
      }
      console.log('Using Bearer Token authentication (SF_ACCESS_TOKEN).');
      SalesforceAuthenticator.setBearerTokenParams(
        process.env.SF_ACCESS_TOKEN,
        process.env.SF_INSTANCE_URL
      );
    } else {
      if (!process.env.SF_CLIENT_ID || !process.env.SF_CLIENT_SECRET || !process.env.SF_INSTANCE_URL) {
        throw new Error('SF_CLIENT_ID, SF_CLIENT_SECRET, and SF_INSTANCE_URL are required for Client Credentials authentication.');
      }
      console.log('Using Client Credentials authentication (SF_CLIENT_ID + SF_CLIENT_SECRET).');
      SalesforceAuthenticator.setClientCredentialsParams(
        process.env.SF_CLIENT_ID,
        process.env.SF_CLIENT_SECRET,
        process.env.SF_INSTANCE_URL
      );
    }

    // --- Translate field names to apiNames using SheetConf ---
    for (const sheetConf of execConf.sheets) {
      const sheet = sheetsData[sheetConf.name];
      if (sheet != null) {
        DataSheetProcessor.translateFieldNamesToApiNames(sheet, sheetConf.fields);
      }
    }

    // processactions
    await ActionProcessor.processActions(execConf, sheetsData);

    // generate output csvs
    try {

      // Generate CSV files for the sheetsData
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
