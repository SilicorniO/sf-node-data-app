/**
 * Generates the enrichment.xlsx input file for this example.
 * Run once before executing the example:
 *   node examples/07-multi-sheet-pipeline/generate-xlsx.js
 *
 * The file contains two sheets:
 *  - "Accounts"   — enriched account data with human-readable column names
 *  - "Activities" — follow-up tasks for the CRM team, also with human-readable headers
 *
 * The conf.yaml declares a `sheets` mapping that translates these column names
 * to Salesforce API field names before any action runs.
 */
const XLSX = require('xlsx');
const path = require('path');

// "Accounts" sheet — human-readable headers mapped to API names via conf.yaml:
//   Company Name      → Name
//   Annual Revenue    → AnnualRevenue
//   Employees         → NumberOfEmployees
//   Rating            → Rating
//   Description       → Description
const accountRows = [
  ['Company Name', 'Annual Revenue', 'Employees', 'Rating', 'Description'],
  ['Acme Corporation',    5000000, 250,  'Hot',  'Leading cloud-technology firm on the West Coast'],
  ['Globex Industries',  12000000, 800,  'Warm', 'Large-scale manufacturing and automation company'],
  ['Initech Solutions',   3500000, 120,  'Hot',  'Boutique consulting firm specialising in ERP rollouts'],
  ['Umbrella Logistics',  8000000, 450,  'Cold', 'National logistics and supply-chain provider'],
  ['Stark Dynamics',     25000000, 1200, 'Warm', 'Cutting-edge R&D company developing next-gen hardware'],
];

// "Activities" sheet — human-readable headers mapped to API names via conf.yaml:
//   Contact Email  → WhoId  (resolved to Contact.Id by the transform step)
//   Company        → WhatId (resolved to Account.Id by the transform step)
//   Task Subject   → Subject
//   Due Date       → ActivityDate
//   Priority Level → Priority
//   Notes          → Description
const activityRows = [
  ['Contact Email', 'Company', 'Task Subject', 'Due Date', 'Priority Level', 'Notes'],
  [
    'john.smith@acme.example.com',
    'Acme Corporation',
    'Q2 Follow-up Call',
    '2026-06-30',
    'High',
    'Schedule the quarterly business review and cloud-roadmap discussion',
  ],
  [
    'jane.doe@globex.example.com',
    'Globex Industries',
    'Schedule Product Demo',
    '2026-06-15',
    'Normal',
    'Arrange live demo of the new factory-automation module',
  ],
  [
    'bob.johnson@initech.example.com',
    'Initech Solutions',
    'Send Proposal',
    '2026-07-15',
    'High',
    'Deliver the revised ERP implementation proposal and pricing sheet',
  ],
  [
    'alice.williams@umbrella.example.com',
    'Umbrella Logistics',
    'Logistics Review Meeting',
    '2026-06-30',
    'Normal',
    'Review progress on the fleet-tracking implementation',
  ],
  [
    'charlie.brown@stark.example.com',
    'Stark Dynamics',
    'R&D Partnership Discussion',
    '2026-08-01',
    'High',
    'Explore joint R&D partnership terms and IP-sharing agreement',
  ],
];

const workbook = XLSX.utils.book_new();

const wsAccounts   = XLSX.utils.aoa_to_sheet(accountRows);
const wsActivities = XLSX.utils.aoa_to_sheet(activityRows);

XLSX.utils.book_append_sheet(workbook, wsAccounts,   'Accounts');
XLSX.utils.book_append_sheet(workbook, wsActivities, 'Activities');

const outputPath = path.join(__dirname, 'enrichment.xlsx');
XLSX.writeFile(workbook, outputPath);
console.log(`Generated: ${outputPath}`);
