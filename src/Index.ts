#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ExecConfReader } from './reader/ExecConfReader';
import { SalesforceAuthenticator } from './salesforce/SalesforceAuthenticator';
import { ExcelReader } from './reader/ExcelReader';
import { CsvReader } from './reader/CsvReader';
import { CsvGenerator } from './generator/CsvGenerator';
import { DataSheet } from './model/DataSheet';
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
const EXCEL_FILE_SUFFIXES = ['.xlsx', '.xls', '.xlsm', '.xlsb'];

class SalesforceAuthenticationConfigurationError extends Error {}

interface ResolvedInputs {
  excelFiles: string[];
  csvFiles: string[];
}

/**
 * Scans a folder (non-recursively) and returns the CSV and Excel files it contains.
 * @param folderPath Path to the folder to scan.
 */
function collectInputFilesFromFolder(folderPath: string): ResolvedInputs {
  const resolvedFolder = path.resolve(folderPath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedFolder, { withFileTypes: true });
  } catch (error: any) {
    throw new Error(`Cannot read input folder "${folderPath}": ${error.message}`);
  }

  const excelFiles: string[] = [];
  const csvFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(resolvedFolder, entry.name);
    const suffix = path.extname(entry.name).toLowerCase();
    if (suffix === CSV_FILE_SUFFIX) {
      csvFiles.push(filePath);
    } else if (EXCEL_FILE_SUFFIXES.includes(suffix)) {
      excelFiles.push(filePath);
    }
  }

  excelFiles.sort();
  csvFiles.sort();
  return { excelFiles, csvFiles };
}

/**
 * Merges explicitly-passed input files with any files discovered in an input folder.
 */
function resolveInputFiles(options: {
  excelFile?: string;
  csvFiles?: string[];
  inputFolder?: string;
}): ResolvedInputs {
  const excelFiles: string[] = [];
  const csvFiles: string[] = [...(options.csvFiles ?? [])];
  if (options.excelFile) {
    excelFiles.push(options.excelFile);
  }
  if (options.inputFolder) {
    const fromFolder = collectInputFilesFromFolder(options.inputFolder);
    excelFiles.push(...fromFolder.excelFiles);
    csvFiles.push(...fromFolder.csvFiles);
  }
  return { excelFiles, csvFiles };
}

async function main(): Promise<void> {
  dotenv.config();
  const program = new Command()
    .requiredOption('-c, --confFile <path>', 'Path to the YAML configuration file')
    .option('-e, --excelFile <path>', 'Path to an Excel input file')
    .option('-o, --outputFolder <path>', 'Folder where output CSV files are written', './')
    .option('-v, --csvFiles <paths...>', 'Paths to CSV input files')
    .option('-i, --inputFolder <path>', 'Folder scanned for all CSV and Excel input files')
    .option('-s, --scriptFile <path>', 'Path to the shared CommonJS transform script (required if any transform action exists)')
    .option('--fromTask <nameOrIndex>', 'Start execution at this action name or 1-based index')
    .option('--toTask <nameOrIndex>', 'Stop execution after this action name or 1-based index')
    .parse(process.argv);

  const options = program.opts();
  let configuration;
  let actionRange: ResolvedActionRange | undefined;
  let inputs: ResolvedInputs;
  console.log('SF Data Pipeline');
  console.log(`[1/6] Loading configuration: ${options.confFile}`);
  try {
    configuration = ExecConfReader.readConfFile(options.confFile, options.scriptFile);
    inputs = resolveInputFiles(options);
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
      [options.confFile, ...inputs.excelFiles, ...inputs.csvFiles].filter(Boolean)
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
  console.log('\n[3/6] Indexing input files');
  try {
    if (options.inputFolder) {
      console.log(`      Input folder: ${options.inputFolder}`);
    }
    // Sheets are read on demand (and released after use) so a large pipeline does
    // not hold every input in memory at once. Register a loader per sheet here.
    const fieldMappings = new Map(
      configuration.sheets.map(sheetConf => [sheetConf.name.toLocaleLowerCase(), sheetConf])
    );
    const applyMappings = (sheet: DataSheet): DataSheet => {
      const sheetConf = fieldMappings.get(sheet.name.toLocaleLowerCase());
      if (sheetConf && sheetConf.fields.length > 0) {
        DataSheetProcessor.translateFieldNamesToApiNames(sheet, sheetConf.fields);
      }
      return sheet;
    };

    if (inputs.excelFiles.length) {
      console.log(`      Excel files: ${inputs.excelFiles.length}`);
      for (const excelFile of inputs.excelFiles) {
        for (const sheetName of ExcelReader.listSheetNames(excelFile)) {
          sheets.registerLoader(
            sheetName,
            async () => applyMappings(await ExcelReader.readWorksheet(excelFile, sheetName)),
            () => applyMappings(ExcelReader.readWorksheetSync(excelFile, sheetName))
          );
          console.log(`        + "${sheetName}" (${excelFile})`);
        }
      }
    }
    if (inputs.csvFiles.length) {
      console.log(`      CSV files: ${inputs.csvFiles.length}`);
      for (const csvFile of inputs.csvFiles) {
        const sheetName = path.basename(csvFile, path.extname(csvFile));
        sheets.registerLoader(
          sheetName,
          async () => applyMappings(await CsvReader.readCsvFile(csvFile)),
          () => applyMappings(CsvReader.readCsvFileSync(csvFile))
        );
        console.log(`        + "${sheetName}" (${csvFile})`);
      }
    }
    console.log(`      Ready: ${inputs.csvFiles.length} CSV file(s) and ${inputs.excelFiles.length} Excel file(s) indexed; sheets load on first use.`);
  } catch (error: any) {
    console.error(`      FAILED while indexing inputs: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n[4/6] Preparing field mappings and authentication');
  try {
    const mappedSheets = configuration.sheets.filter(sheetConf => sheetConf.fields.length > 0);
    if (mappedSheets.length > 0) {
      console.log(`      Field mappings configured for ${mappedSheets.length} sheet(s); applied as each sheet loads.`);
    } else {
      console.log('      No field mappings configured.');
    }
    const selectedActions = actionRange!.end < actionRange!.start
      ? []
      : configuration.actions.slice(actionRange!.start, actionRange!.end + 1);
    const requiresSalesforce = selectedActions.some(action => action.type !== 'transform');
    const authentication = configureSalesforceAuthentication(requiresSalesforce);
    console.log(`      Authentication: ${authentication}.`);
    if (requiresSalesforce) {
      const connection = await SalesforceAuthenticator.authenticate();
      console.log(`      Connected to: ${new URL(connection.instanceUrl).hostname}.`);
    }
  } catch (error: any) {
    console.error(`      FAILED while preparing mappings or authentication: ${error.message}`);
    if (error instanceof SalesforceAuthenticationConfigurationError) {
      printSalesforceAuthenticationHelp();
    }
    process.exitCode = 1;
    return;
  }

  let runtimeFailure: Error | undefined;
  let writtenSheets = 0;
  console.log(`\n[5/6] Executing ${describeActionRange(configuration.actions, actionRange!)}`);
  console.log(`      Writing each produced sheet as CSV to: ${options.outputFolder}`);
  try {
    const result = await ActionProcessor.processActions(configuration, sheets, {
      fromTask: options.fromTask,
      toTask: options.toTask,
      // Stream each sheet to disk the moment it is produced, then it can be released.
      onSheetProduced: async (sheetName, sheet) => {
        await CsvGenerator.generateCsvFile(sheet, options.outputFolder, `${sheetName}${CSV_FILE_SUFFIX}`);
        writtenSheets++;
        console.log(`        + ${sheetName}${CSV_FILE_SUFFIX}: ${sheet.data.length} row(s)`);
      },
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
    console.warn('      Produced sheets were already written as they completed; error details are preserved.');
  }

  // Any sheets still resident in memory (e.g. loaded inputs never streamed by an action)
  // are flushed here so no output is lost.
  const remaining = sheets.entries().filter(([name]) => !name.endsWith('-errors'));
  console.log(`\n[6/6] Flushing ${remaining.length} remaining sheet(s) as CSV to: ${options.outputFolder}`);
  try {
    for (const [sheetName, sheet] of remaining) {
      await CsvGenerator.generateCsvFile(
        sheet,
        options.outputFolder,
        `${sheetName}${CSV_FILE_SUFFIX}`
      );
      writtenSheets++;
      console.log(`        + ${sheetName}${CSV_FILE_SUFFIX}: ${sheet.data.length} row(s)`);
    }
    console.log(`      Wrote ${writtenSheets} CSV file(s) in total.`);
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

function configureSalesforceAuthentication(required: boolean): string {
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
    SalesforceAuthenticator.setSfCliParams();
    return 'Salesforce CLI active org (environment credentials not found)';
  }
  return 'not required (transform-only pipeline)';
}

function printSalesforceAuthenticationHelp(): void {
  console.error('      How to fix it (choose one option):');
  console.error('        1. Set a bearer token:');
  console.error('           export SF_INSTANCE_URL="https://your-domain.my.salesforce.com"');
  console.error('           export SF_ACCESS_TOKEN="<access-token>"');
  console.error('        2. Set Connected App credentials:');
  console.error('           export SF_INSTANCE_URL="https://your-domain.my.salesforce.com"');
  console.error('           export SF_CLIENT_ID="<client-id>"');
  console.error('           export SF_CLIENT_SECRET="<client-secret>"');
  console.error('        3. Configure the Salesforce CLI fallback:');
  console.error('           sf org login web --alias my-org');
  console.error('           sf config set target-org=my-org');
  console.error('      Variables may also be placed in a .env file in the current directory.');
  console.error('      After configuring one option, rerun the same command.');
}

void main();
