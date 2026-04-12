# Example 02 — Insert Contacts

**API mode:** sObject Collections (synchronous)  
**Input format:** CSV  
**Salesforce objects:** Account (read), Contact (insert)  
**Prerequisites:** Run [example 01](../01-insert-accounts/) first.

## What this example does

Inserts 5 Contact records, each linked to one of the Accounts created in example 01.

The CSV contains the Account **Name** (human-readable) in the `AccountId` column.
The pipeline resolves those names to real Salesforce IDs before inserting:

1. **Export** — query all Accounts from Salesforce to get their `Id` values.
2. **Transform** — replace each Account Name in `AccountId` with the real Salesforce ID using a cross-sheet lookup.
3. **Insert** — send the Contacts to Salesforce via the sObject Collections API.

## Files

| File | Description |
|---|---|
| `contacts.csv` | 5 Contact records; `AccountId` column holds the Account Name |
| `conf.yaml` | Two-action pipeline: export Accounts → transform + insert Contacts |
| `output/` | Result CSV written here after execution |

## The lookup pattern

In `contacts.csv`, the `AccountId` column contains the Account Name:

```
FirstName,LastName,Email,...,AccountId
John,Smith,john.smith@acme.example.com,...,Acme Corporation
```

The transform expression `'${Accounts.Name.Id}'` reads as:
> "In the **Accounts** sheet, find the row where **Name** equals the current value of this field (`Acme Corporation`), and return the **Id**."

The result replaces the name with the real Salesforce ID before the insert.

## How to run

```bash
node dist/Index.js \
  -c examples/02-insert-contacts/conf.yaml \
  -v examples/02-insert-contacts/contacts.csv \
  -o examples/02-insert-contacts/output/
```

## Expected output

`output/contacts.csv` — input data with two extra columns:

| Column | Description |
|---|---|
| `Id` | Salesforce Contact ID |
| `_ErrorInsertMessage` | Error message if a row failed |

## Key concepts

- **`processingType: "api"`** — uses the sObject Collections REST API (synchronous, up to 200 records per batch). Errors are returned immediately, making it easier to debug small data sets.
- **Cross-sheet lookup** — `'${SheetName.MatchField.TargetField}'` is the core pattern for ID resolution across related objects.
- **Sheet mapping** — the `sheets` section in `conf.yaml` maps the `AccountId` column name to the `AccountId` API field name (no rename needed here, but the pattern is shown for clarity).
- **`rollbackOnError: true`** — if the Contact insert fails, the export has no side effects, so rollback effectively means no Contacts were created.
