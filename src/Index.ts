// src/Index.ts
import { ExcelProcessor } from './ExcelProcessor';
import { DataSheet } from './model/DataSheet';
import { Command } from 'commander';

async function main() {
  const program = new Command();

  program
    .requiredOption('-e, --excelFile <path>', 'Path to the Excel file')
    .option('-f, --includeFieldNames', 'Indicates that the Excel file has a header row with field names', false)
    .parse(process.argv);

  const excelFilePath = program.opts().excelFile;
  const includeFieldNames = program.opts().includeFieldNames;

  try {
    const sheetsData = await ExcelProcessor.readExcelFile(excelFilePath, includeFieldNames);

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
  } catch (error) {
    console.error('Failed to process Excel file:', error);
    process.exit(1);
  }
}

main();
