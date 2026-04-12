# Example 04 — Update Opportunities

**API mode:** sObject Collections (synchronous)  
**Input format:** CSV  
**Salesforce objects:** Opportunity (read + update)  
**Prerequisites:** Run [example 03](../03-insert-opportunities/) first.

## What this example does

Updates the `StageName` and `Amount` of the 5 Opportunities inserted in example 03.

The CSV contains only the columns you want to change (`Name`, `StageName`, `Amount`).
The pipeline fetches the Salesforce `Id` for each record automatically:

1. **Export** — query Salesforce for existing Opportunities, merging the results into the CSV sheet. The CSV values win (they are the "master"), but the `Id` from Salesforce fills in the missing column.
2. **Update** — send the updated `StageName` and `Amount` to Salesforce using the `Id`.

## Files

| File | Description |
|---|---|
| `opportunities-update.csv` | New `StageName` and `Amount` for each Opportunity |
| `conf.yaml` | Single action: export to get IDs, then update |
| `output/` | Result CSV written here after execution |

## The export-then-update pattern

The CSV sheet starts with only three columns:

```
Name,StageName,Amount
Acme Q1 Cloud Deal,Closed Won,58000
...
```

The export action runs a SOQL query and merges the results into the same sheet
(`outputSheet` defaults to `inputSheet`). Since the CSV is the **master** in the merge,
the new `StageName` and `Amount` values are preserved. Salesforce contributes the `Id`
(and other fields not in the CSV) from the secondary data source.

After the merge the sheet looks like:

```
Name,StageName,Amount,Id,CloseDate,...
Acme Q1 Cloud Deal,Closed Won,58000,006XXXXXXXXXXXX,...
...
```

The update action then sends `Id + StageName + Amount` to Salesforce.

## How to run

```bash
node dist/Index.js \
  -c examples/04-update-opportunities/conf.yaml \
  -v examples/04-update-opportunities/opportunities-update.csv \
  -o examples/04-update-opportunities/output/
```

## Expected output

`output/opportunities-update.csv` — the merged sheet with extra columns:

| Column | Description |
|---|---|
| `Id` | Salesforce Opportunity ID (from the export) |
| `_ErrorInsertMessage` | Error message if a row failed |

## Key concepts

- **Export + update in one action** — a single action block can contain both `exportAction` and `importAction`. The processor always runs them in order: export → transform → import.
- **Master/secondary merge** — `mergeDataSheets` treats the existing sheet data (CSV) as master. Master values are never overwritten by the export; only columns missing from the master (like `Id`) are filled in from Salesforce.
- **`rollbackOnError: false`** — updates are generally safe to retry (they are idempotent), so rollback is disabled.
- **Minimal payload** — `importFields` lists only `StageName` and `Amount`. The `Id` is always included automatically when updating.
