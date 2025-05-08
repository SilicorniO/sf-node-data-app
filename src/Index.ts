// src/Index.ts
import { DataSheet } from './model/DataSheet';
import { Command } from 'commander';
import { ExecConfReader } from './reader/ExecConfReader';
import { ExcelReader } from './reader/ExcelReader';

async function main() {
  const program = new Command();

  program
    .requiredOption('-e, --excelFile <path>', 'Path to the Excel file')
    .requiredOption('-c, --confFile <path>', 'Path to the JSON configuration file')
    .option('-f, --includeFieldNames', 'Indicates that the Excel file has a header row with field names', false)
    .parse(process.argv);

  const excelFilePath = program.opts().excelFile;
  const confFilePath = program.opts().confFile;
  const includeFieldNames = program.opts().includeFieldNames;

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

  } catch (error) {
    console.error('Failed to process files:', error);
    process.exit(1);
  }
}

main();
