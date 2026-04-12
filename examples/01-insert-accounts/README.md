# Example 01 — Insert Accounts

**API mode:** Bulk API v2  
**Input format:** CSV  
**Salesforce object:** Account  
**Prerequisites:** None — run this first.

## What this example does

Inserts 5 Account records into Salesforce from a CSV file using the Bulk API v2.
This is the simplest possible pipeline: one action, one file, one object.

After this runs, the output CSV will contain the new Salesforce `Id` for each row.
The data inserted here is used by examples 02, 03, 04, and 05.

## Files

| File | Description |
|---|---|
| `accounts.csv` | 5 Account records with billing address, phone, industry, and website |
| `conf.yaml` | Single insert action targeting the Account object |
| `output/` | Result CSV written here after execution |

## How to run

```bash
# From the project root
node dist/Index.js \
  -c examples/01-insert-accounts/conf.yaml \
  -v examples/01-insert-accounts/accounts.csv \
  -o examples/01-insert-accounts/output/
```

Or with `ts-node` (development):

```bash
ts-node src/Index.ts \
  -c examples/01-insert-accounts/conf.yaml \
  -v examples/01-insert-accounts/accounts.csv \
  -o examples/01-insert-accounts/output/
```

## Expected output

`output/accounts.csv` — a copy of the input with two extra columns:

| Column | Description |
|---|---|
| `Id` | The Salesforce record ID assigned after successful insert |
| `_ErrorInsertMessage` | Error details if a row failed (empty on success) |

## Key concepts

- **`processingType: "bulk"`** — uses Bulk API v2, which is asynchronous. The app polls the job status until completion.
- **`rollbackOnError: true`** — if any action fails, all previously inserted records in the same run are automatically deleted.
- **`importFields`** — only the listed fields are sent to Salesforce. Any extra columns in the CSV are ignored.
- **Idempotency** — if you run this example twice, the second run will attempt to insert duplicates. To avoid that, pair it with an export step that checks for existing records (see example 03).
