# Example 03 — Insert Opportunities (from Excel)

**API mode:** Bulk API v2  
**Input format:** Excel (.xlsx)  
**Salesforce objects:** Account (read), Opportunity (read + insert)  
**Prerequisites:** Run [example 01](../01-insert-accounts/) first.

## What this example does

Inserts 5 Opportunity records from an Excel file, each linked to one of the Accounts
created in example 01. It also demonstrates **idempotency**: if some Opportunities
already exist in Salesforce, they are skipped — only new records are inserted.

The pipeline has three steps:

1. **Export Accounts** — fetch Account IDs from Salesforce to resolve the `AccountId` lookup.
2. **Export existing Opportunities** — fetch any existing Opportunities by `Name` and merge them into the sheet. Rows that already have an `Id` are automatically skipped by the insert action.
3. **Transform + Insert** — resolve the Account Name to a Salesforce ID, then insert only the rows without an existing Salesforce ID.

## Files

| File | Description |
|---|---|
| `opportunities.xlsx` | Excel workbook with one sheet named `Opportunities` |
| `conf.yaml` | Three-action pipeline with idempotent insert |
| `generate-xlsx.js` | Script to regenerate `opportunities.xlsx` if needed |
| `output/` | Result CSV written here after execution |

### Generate the Excel file

The Excel file is already included. To regenerate it:

```bash
node examples/03-insert-opportunities/generate-xlsx.js
```

## Excel sheet structure

The `Opportunities` sheet contains:

| Column | Description |
|---|---|
| `Name` | Opportunity name (unique key) |
| `AccountId` | Account Name — resolved to a Salesforce ID by the transform step |
| `StageName` | Sales stage |
| `CloseDate` | Expected close date (`YYYY-MM-DD`) |
| `Amount` | Deal value |
| `Description` | Free-text description |

## How to run

```bash
node dist/Index.js \
  -c examples/03-insert-opportunities/conf.yaml \
  -e examples/03-insert-opportunities/opportunities.xlsx \
  -o examples/03-insert-opportunities/output/
```

## Expected output

`output/Opportunities.csv` — the sheet data with extra columns:

| Column | Description |
|---|---|
| `Id` | Salesforce Opportunity ID (set after insert) |
| `_ErrorInsertMessage` | Error message if a row failed |

## Key concepts

- **Excel input** — use `-e` instead of `-v`. Each sheet tab becomes a named DataSheet; the sheet name (`Opportunities`) is used as the key throughout the pipeline.
- **Idempotent insert** — when `action: "insert"` is used and a row already has an `Id` value (populated by the export step), that row is automatically filtered out. Re-running the example only inserts records that do not yet exist.
- **Sheet name mapping** — `conf.yaml` declares a `sheets` entry for `Opportunities` so the `AccountId` column (holding Account Names) is correctly identified as the `AccountId` API field.

The data inserted here (the 5 Opportunities) is used in example 04.
