# Example 01 — Insert Accounts

Inserts `accounts.csv` into Salesforce Account through Bulk API v2. The INSERT
action explicitly lists sent fields and writes successful `_InputRow,Id` mappings
to `Inserted Account IDs.csv`.

```bash
node dist/Index.js \
  -c examples/01-insert-accounts/conf.yaml \
  -v examples/01-insert-accounts/accounts.csv \
  -o examples/01-insert-accounts/output/
```

Rows that already contain an Id are written to `Insert Accounts-errors.csv` and
are not sent to Salesforce.
