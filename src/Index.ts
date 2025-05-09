// src/Index.ts
import { DataSheet } from './model/DataSheet';
import { Command } from 'commander';
import { ExecConfReader } from './reader/ExecConfReader';
import { SalesforceAuthenticator } from './salesforce/SalesforceAuthenticator'; // Import the authenticator
import { SalesforceLoader } from './loader/SalesforceLoader'; // Import the loader
import { ExcelReader } from './reader/ExcelReader';
import * as dotenv from 'dotenv';
import { ExcelGenerator } from './reader/ExcelGenerator';
import { DataSheetProcessor } from './processor/DataSheetProcessor';


async function main() {
  // Load environment variables from .env file
  dotenv.config();

  const program = new Command();
  program
    .requiredOption('-e, --excelFile <path>', 'Path to the Excel file')
    .requiredOption('-c, --confFile <path>', 'Path to the JSON configuration file')
    .option('-o, --outputFolder <path>', 'Path to the folder where output files will be created') // New parameter
    .option('-f, --includeFieldNames', 'Indicates that the Excel file has a header row with field names', false)
    .option('-i, --import', 'Indicates that the data should be imported to Salesforce', false) // Add the import option
    .parse(process.argv);

  const excelFilePath = program.opts().excelFile;
  const confFilePath = program.opts().confFile;
  const outputFolder = program.opts().outputFolder || './'; // Default to current directory if not provided
  const includeFieldNames = program.opts().includeFieldNames;
  const shouldImport = program.opts().import; // Get the value of the import option

  try {
    // Read data
    const execConf = ExecConfReader.readConfFile(confFilePath);
    const sheetsData = await ExcelReader.readExcelFile(excelFilePath, includeFieldNames);

    
    // Conditionally import data to Salesforce
    if (shouldImport) {
      console.log('Import parameter is true. Starting Salesforce import...');
        // Set Salesforce authentication parameters
        SalesforceAuthenticator.setAuthParams(
          process.env.SF_CLIENT_ID!,  // Use environment variables
          process.env.SF_CLIENT_SECRET!,
          process.env.SF_INSTANCE_URL!
        );

      await SalesforceLoader.loadData(execConf, sheetsData);

      //generate an excel file with the updated data
      await ExcelGenerator.generateExcelFile(
        sheetsData,
        outputFolder + '/import_results.xlsx', // Specify the output file name
        includeFieldNames
      );
      
    } else {
      console.log('Import parameter not found. Transforming and generating Excel...');
      const transformedSheetsData = DataSheetProcessor.processAllDataSheets(sheetsData, execConf.objectsConf);

      await ExcelGenerator.generateExcelFile(
        transformedSheetsData,
        outputFolder + '/transform_results.xlsx',
        includeFieldNames
      );
    }

  } catch (error) {
    console.error('Failed to process files:', error);
    process.exit(1);
  }
}

main();
