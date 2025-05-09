// src/Index.ts
import { DataSheet } from './model/DataSheet';
import { Command } from 'commander';
import { ExecConfReader } from './reader/ExecConfReader';
import { SalesforceAuthenticator } from './salesforce/SalesforceAuthenticator'; // Import the authenticator
import { SalesforceLoader } from './loader/SalesforceLoader'; // Import the loader
import { ExcelReader } from './reader/ExcelReader';
import * as dotenv from 'dotenv';
import { ExcelGenerator } from './reader/ExcelGenerator';


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
    const execConf = ExecConfReader.readConfFile(confFilePath);

    const sheetsData = await ExcelReader.readExcelFile(excelFilePath, includeFieldNames);

    for (const sheetName in sheetsData) {
      if (sheetsData.hasOwnProperty(sheetName)) {
        const sheet: DataSheet = sheetsData[sheetName];
        console.log(`Sheet Name: ${sheet.name}`);
        console.log(`Field Names: ${sheet.fieldNames.join(', ')}`);
        console.log(`API Names: ${sheet.apiNames.join(', ')}`);
        console.log('Data:');
        sheet.data.forEach(row => console.log(row));
        console.log('\n');
      }
    }
    console.log("Configuration", execConf);

    // Conditionally import data to Salesforce
    if (shouldImport) {
      console.log('Import parameter is true. Starting Salesforce import...');
        // Set Salesforce authentication parameters
        SalesforceAuthenticator.setAuthParams(
          process.env.SF_CLIENT_ID!,  // Use environment variables
          process.env.SF_CLIENT_SECRET!,
          process.env.SF_INSTANCE_URL!
        );

      const updatedSheetsData = await SalesforceLoader.loadData(execConf, sheetsData);

      //generate an excel file with the updated data
      await ExcelGenerator.generateExcelFile(
        updatedSheetsData,
        outputFolder + '/import_results.xlsx', // Specify the output file name
        includeFieldNames
      );
      
    } else {
      console.log('Import parameter is false. Skipping Salesforce import.');
    }

  } catch (error) {
    console.error('Failed to process files:', error);
    process.exit(1);
  }
}

main();
