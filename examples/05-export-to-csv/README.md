# Example 05 — Export to CSV

**API mode:** Bulk API v2  
**Input format:** None (no input file required)  
**Salesforce objects:** Account, Contact, Opportunity (all read)  
**Prerequisites:** Run examples 01, 02, and 03 first for meaningful results.

## What this example does

Exports Accounts, Contacts, and Opportunities from Salesforce to separate CSV files
using the Bulk API v2 query. This is a pure read operation — no data is written
to Salesforce.

Each export action produces a standalone CSV file in the output folder.

## Files

| File | Description |
|---|---|
| `conf.yaml` | Three independent export actions, one per object |
| `output/` | Three CSV files written here after execution |

## How to run

```bash
node dist/Index.js \
  -c examples/05-export-to-csv/conf.yaml \
  -o examples/05-export-to-csv/output/
```

No `-e` or `-v` flag is needed — this example queries Salesforce directly.

## Expected output

Three CSV files in `output/`:

| File | Contents |
|---|---|
| `Accounts.csv` | All Account records sorted by name |
| `Contacts.csv` | All Contact records sorted by last name |
| `Opportunities.csv` | All Opportunity records sorted by name |

Each file contains the exact columns selected in the SOQL query.

## Key concepts

- **Export-only actions** — an action with only `exportAction` (no `importAction`) is a pure read. The result is written to the output CSV but Salesforce is not modified.
- **`outputSheet`** — the name given to the in-memory sheet, which also becomes the output CSV filename. Here `Accounts`, `Contacts`, and `Opportunities` produce correspondingly named files.
- **Independent actions** — unlike examples 02 and 03, these three actions do not depend on each other's data. They run sequentially but could be split into separate config files if needed.
- **SOQL flexibility** — any valid SOQL query works, including `WHERE`, `ORDER BY`, relationship fields (`Account.Name`), aggregate functions, etc.
