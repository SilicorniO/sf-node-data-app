#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { ExecConfReader } from './reader/ExecConfReader';
import { SalesforceAuthenticator } from './salesforce/SalesforceAuthenticator';
import { ExcelReader } from './reader/ExcelReader';
import { CsvReader } from './reader/CsvReader';
import { CsvGenerator } from './generator/CsvGenerator';
import {
  ActionProcessor,
  ConfigurationPreflightError,
  describeActionRange,
  PipelineExecutionError,
  resolveActionRange,
  ResolvedActionRange,
} from './processor/ActionProcessor';
import { DataSheetProcessor } from './processor/DataSheetProcessor';
import { OutputCleaner } from './processor/OutputCleaner';
import { SheetRegistry } from './processor/SheetRegistry';

const CSV_FILE_SUFFIX = '.csv';

class SalesforceAuthenticationConfigurationError extends Error {}

async function main(): Promise<void> {
  dotenv.config();
  const program = new Command()
    .requiredOption('-c, --confFile <path>', 'Path to the YAML configuration file')
    .option('-e, --excelFile <path>', 'Path to an Excel input file')
    .option('-o, --outputFolder <path>', 'Folder where output CSV files are written', './')
    .option('-v, --csvFiles <paths...>', 'Paths to CSV input files')
    .option('--fromTask <nameOrIndex>', 'Start execution at this action name or 1-based index')
    .option('--toTask <nameOrIndex>', 'Stop execution after this action name or 1-based index')
    .parse(process.argv);

  const options = program.opts();
  let configuration;
  let actionRange: ResolvedActionRange | undefined;
  console.log('SF Data Pipeline');
  console.log(`[1/6] Loading configuration: ${options.confFile}`);
  try {
    configuration = ExecConfReader.readConfFile(options.confFile);
    actionRange = resolveActionRange(configuration.actions, options.fromTask, options.toTask);
    console.log(
      `      Ready: ${configuration.actions.length} action(s), `
      + `${configuration.sheets.length} declared input sheet(s), `
      + `processing type "${configuration.appConfiguration.processingType}".`
    );
    if (configuration.actions.length > 0 && (options.fromTask || options.toTask)) {
      console.log(`      Execution range: ${describeActionRange(configuration.actions, actionRange)}.`);
    }
  } catch (error: any) {
    console.error(`      FAILED: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[2/6] Preparing output folder: ${options.outputFolder}`);
  try {
    const cleanup = OutputCleaner.clean(
      options.outputFolder,
      configuration.appConfiguration.cleanOutputFolderBeforeExecution,
      configuration.appConfiguration.deleteErrorFilesBeforeExecution,
      configuration.actions.map(action => action.errorSheet),
      [options.confFile, options.excelFile, ...(options.csvFiles ?? [])].filter(Boolean)
    );
    if (cleanup.mode === 'all') {
      console.log(`      Cleaned output folder: deleted ${cleanup.deletedFiles} file(s).`);
    } else if (cleanup.mode === 'errors') {
      console.log(`      Deleted ${cleanup.deletedFiles} previous error file(s).`);
    } else {
      console.log('      Cleanup disabled; existing output files are preserved until replaced.');
    }
  } catch (error: any) {
    console.error(`      FAILED while preparing output folder: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const sheets = new SheetRegistry();
  console.log('\n[3/6] Reading all input files');
  try {
    if (options.excelFile) {
      console.log(`      Excel: ${options.excelFile}`);
      const excelSheets = await ExcelReader.readExcelFile(options.excelFile);
      for (const [name, sheet] of Object.entries(excelSheets)) {
        sheets.addInput(name, sheet);
        console.log(`        + "${name}": ${sheet.data.length} row(s), ${sheet.fieldNames.length} column(s)`);
      }
    }
    if (options.csvFiles?.length) {
      console.log(`      CSV files: ${options.csvFiles.length}`);
      const csvSheets = await CsvReader.readCsvFiles(options.csvFiles);
      for (const [name, sheet] of Object.entries(csvSheets)) {
        sheets.addInput(name, sheet);
        console.log(`        + "${name}": ${sheet.data.length} row(s), ${sheet.fieldNames.length} column(s)`);
      }
    }
    const inputEntries = sheets.entries();
    const inputRows = inputEntries.reduce((total, [, sheet]) => total + sheet.data.length, 0);
    console.log(`      Ready: ${inputEntries.length} input sheet(s), ${inputRows} total row(s).`);
  } catch (error: any) {
    console.error(`      FAILED while reading inputs: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n[4/6] Applying input field mappings');
  try {
    let mappedFields = 0;
    let mappedSheets = 0;
    for (const sheetConfiguration of configuration.sheets) {
      const sheet = sheets.get(sheetConfiguration.name);
      if (!sheet) {
        console.warn(`      SKIP "${sheetConfiguration.name}": no loaded input sheet has this name.`);
        continue;
      }
      if (sheetConfiguration.fields.length === 0) {
        console.log(`      "${sheet.name}": no translations configured.`);
        continue;
      }
      const result = DataSheetProcessor.translateFieldNamesToApiNames(sheet, sheetConfiguration.fields);
      mappedFields += result.translated.length;
      mappedSheets++;
      console.log(`      "${sheet.name}": translated ${result.translated.length} field(s).`);
      if (result.missing.length > 0) {
        console.warn(`        Missing source columns: ${result.missing.join(', ')}`);
      }
    }
    console.log(`      Ready: ${mappedFields} field mapping(s) applied across ${mappedSheets} sheet(s).`);
    const selectedActions = actionRange!.end < actionRange!.start
      ? []
      : configuration.actions.slice(actionRange!.start, actionRange!.end + 1);
    const requiresSalesforce = selectedActions.some(action => action.type !== 'transform');
    const authentication = configureSalesforceAuthentication(
      configuration.appConfiguration.processingType,
      requiresSalesforce
    );
    console.log(`      Authentication: ${authentication}.`);
    if (requiresSalesforce) {
      const connection = await SalesforceAuthenticator.authenticate();
      console.log(`      Connected to: ${new URL(connection.instanceUrl).hostname}.`);
    }
  } catch (error: any) {
    console.error(`      FAILED while preparing mappings or authentication: ${error.message}`);
    if (error instanceof SalesforceAuthenticationConfigurationError) {
      printSalesforceAuthenticationHelp(options.confFile);
    }
    process.exitCode = 1;
    return;
  }

  let runtimeFailure: Error | undefined;
  console.log(`\n[5/6] Executing ${describeActionRange(configuration.actions, actionRange!)}`);
  try {
    const result = await ActionProcessor.processActions(configuration, sheets, {
      fromTask: options.fromTask,
      toTask: options.toTask,
    });
    if (result.hadContinuedErrors) {
      console.warn('      Pipeline completed with accepted row errors. Review the generated error CSV files.');
    } else {
      console.log('      Pipeline actions completed successfully.');
    }
  } catch (error: any) {
    if (error instanceof ConfigurationPreflightError) {
      console.error(`      PRECHECK FAILED: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    runtimeFailure = error;
    console.error(`      FAILED: ${error instanceof PipelineExecutionError ? error.message : `Pipeline failed: ${error.message}`}`);
    console.warn('      Continuing to output generation so completed sheets and error details are preserved.');
  }

  const outputEntries = sheets.entries();
  console.log(`\n[6/6] Writing ${outputEntries.length} sheet(s) as CSV to: ${options.outputFolder}`);
  try {
    for (const [sheetName, sheet] of outputEntries) {
      await CsvGenerator.generateCsvFile(
        sheet,
        options.outputFolder,
        `${sheetName}${CSV_FILE_SUFFIX}`
      );
      console.log(`        + ${sheetName}${CSV_FILE_SUFFIX}: ${sheet.data.length} row(s)`);
    }
    console.log(`      Wrote ${outputEntries.length} CSV file(s).`);
  } catch (error: any) {
    console.error(`      FAILED while writing outputs: ${error.message}`);
    runtimeFailure = runtimeFailure ?? error;
  }

  if (runtimeFailure) {
    console.error('\nPipeline finished with errors.');
    process.exitCode = 1;
  } else {
    console.log('\nPipeline finished successfully.');
  }
}

function configureSalesforceAuthentication(
  processingType: string,
  required: boolean
): string {
  if (processingType === 'sf') {
    SalesforceAuthenticator.setSfCliParams();
    return 'Salesforce CLI active org';
  }
  if (process.env.SF_ACCESS_TOKEN) {
    if (!process.env.SF_INSTANCE_URL) {
      throw new SalesforceAuthenticationConfigurationError(
        'SF_INSTANCE_URL is required when using SF_ACCESS_TOKEN.'
      );
    }
    SalesforceAuthenticator.setBearerTokenParams(
      process.env.SF_ACCESS_TOKEN,
      process.env.SF_INSTANCE_URL
    );
    return 'bearer token from environment';
  }
  if (process.env.SF_CLIENT_ID || process.env.SF_CLIENT_SECRET || process.env.SF_INSTANCE_URL) {
    if (!process.env.SF_CLIENT_ID || !process.env.SF_CLIENT_SECRET || !process.env.SF_INSTANCE_URL) {
      throw new SalesforceAuthenticationConfigurationError(
        'SF_CLIENT_ID, SF_CLIENT_SECRET, and SF_INSTANCE_URL must be provided together.'
      );
    }
    SalesforceAuthenticator.setClientCredentialsParams(
      process.env.SF_CLIENT_ID,
      process.env.SF_CLIENT_SECRET,
      process.env.SF_INSTANCE_URL
    );
    return 'client credentials from environment';
  }
  if (required) {
    throw new SalesforceAuthenticationConfigurationError(
      'Salesforce authentication is not configured.'
    );
  }
  return 'not required (transform-only pipeline)';
}

function printSalesforceAuthenticationHelp(confFile: string): void {
  console.error('      How to fix it (choose one option):');
  console.error('        1. Keep processingType "bulk" or "api" and set a bearer token:');
  console.error('           export SF_INSTANCE_URL="https://your-domain.my.salesforce.com"');
  console.error('           export SF_ACCESS_TOKEN="<access-token>"');
  console.error('        2. Keep processingType "bulk" or "api" and set Connected App credentials:');
  console.error('           export SF_INSTANCE_URL="https://your-domain.my.salesforce.com"');
  console.error('           export SF_CLIENT_ID="<client-id>"');
  console.error('           export SF_CLIENT_SECRET="<client-secret>"');
  console.error('        3. Use the Salesforce CLI active org:');
  console.error('           sf org login web --alias my-org');
  console.error('           sf config set target-org=my-org');
  console.error(`           Then set appConfiguration.processingType to "sf" in ${confFile}`);
  console.error('      Variables may also be placed in a .env file in the current directory.');
  console.error('      After configuring one option, rerun the same command.');
}

void main();
