# Examples

These examples form a sequential scenario: loading CRM data (Accounts, Contacts,
Opportunities) into Salesforce, then updating and exporting it. Run them in order
for the full end-to-end experience.

## Scenario

A company is migrating its CRM data into Salesforce. The data lives in CSV and Excel
files and must be loaded in dependency order: Accounts first, then Contacts and
Opportunities that reference those Accounts, and finally updates to existing records.

## Example sequence

| # | Example | API Mode | Input | Depends on |
|---|---|---|---|---|
| 01 | [Insert Accounts](./01-insert-accounts/) | Bulk API v2 | CSV | — |
| 02 | [Insert Contacts](./02-insert-contacts/) | sObject Collections | CSV | 01 |
| 03 | [Insert Opportunities](./03-insert-opportunities/) | Bulk API v2 | Excel | 01 |
| 04 | [Update Opportunities](./04-update-opportunities/) | sObject Collections | CSV | 03 |
| 05 | [Export to CSV](./05-export-to-csv/) | Bulk API v2 | None | 01–04 |
| 06 | [Transform Only](./06-transform-only/) | — | CSV | — (standalone) |

## Quick start

```bash
# 1. Set up credentials
cp .env.example .env   # fill in SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL

# 2. Build the project
npm run build

# 3. Run examples in order
node dist/Index.js -c examples/01-insert-accounts/conf.yaml    -v examples/01-insert-accounts/accounts.csv             -o examples/01-insert-accounts/output/
node dist/Index.js -c examples/02-insert-contacts/conf.yaml    -v examples/02-insert-contacts/contacts.csv              -o examples/02-insert-contacts/output/
node dist/Index.js -c examples/03-insert-opportunities/conf.yaml -e examples/03-insert-opportunities/opportunities.xlsx -o examples/03-insert-opportunities/output/
node dist/Index.js -c examples/04-update-opportunities/conf.yaml -v examples/04-update-opportunities/opportunities-update.csv -o examples/04-update-opportunities/output/
node dist/Index.js -c examples/05-export-to-csv/conf.yaml                                                               -o examples/05-export-to-csv/output/

# Example 06 needs no Salesforce credentials
node dist/Index.js -c examples/06-transform-only/conf.yaml     -v examples/06-transform-only/employees.csv             -o examples/06-transform-only/output/
```

## Concepts covered

| Concept | Examples |
|---|---|
| Simple insert from CSV | 01 |
| Insert from Excel | 03 |
| Cross-object ID resolution (lookup transform) | 02, 03 |
| Idempotent insert (skip existing records) | 03 |
| Export + update in one action | 04 |
| Pure export (SOQL → CSV) | 05 |
| Field transformations (concat, conditional, math) | 06 |
| Bulk API v2 (async, large volumes) | 01, 03, 05 |
| sObject Collections API (sync, small batches) | 02, 04 |
| Rollback on error | 01, 02, 03 |
