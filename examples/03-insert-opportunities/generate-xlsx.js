/**
 * Generates the opportunities.xlsx input file for this example.
 * Run once before executing the example:
 *   node examples/03-insert-opportunities/generate-xlsx.js
 */
const XLSX = require('xlsx');
const path = require('path');

const rows = [
  // AccountId column holds the Account Name — it is resolved to a real
  // Salesforce Id by the transform step in conf.yaml.
  ['Name', 'AccountId', 'StageName', 'CloseDate', 'Amount', 'Description'],
  ['Acme Q1 Cloud Deal', 'Acme Corporation', 'Prospecting', '2026-03-31', 50000, 'Cloud infrastructure migration'],
  ['Globex Expansion Pack', 'Globex Industries', 'Qualification', '2026-04-30', 75000, 'Factory automation expansion'],
  ['Initech Digital Transformation', 'Initech Solutions', 'Needs Analysis', '2026-05-31', 120000, 'Full digital transformation project'],
  ['Umbrella Fleet Optimization', 'Umbrella Logistics', 'Value Proposition', '2026-06-30', 35000, 'Fleet tracking system'],
  ['Stark Alpha Project', 'Stark Dynamics', 'Id. Decision Makers', '2026-07-31', 200000, 'R&D partnership project'],
];

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(workbook, worksheet, 'Opportunities');

const outputPath = path.join(__dirname, 'opportunities.xlsx');
XLSX.writeFile(workbook, outputPath);
console.log(`Generated: ${outputPath}`);
