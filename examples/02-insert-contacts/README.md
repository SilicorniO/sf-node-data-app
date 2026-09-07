# Example 02 — Insert Contacts

Requires the Accounts from example 01. The pipeline:

1. GETs Account Id/Name values.
2. Runs `resolve-account-id.js` per contact, using `lookup` to replace the
   Account name in `AccountId`.
3. INSERTs the transformed `contacts-ready` sheet.

```bash
node dist/Index.js \
  -c examples/02-insert-contacts/conf.yaml \
  -v examples/02-insert-contacts/contacts.csv \
  -o examples/02-insert-contacts/output/
```

Successful IDs are written to `Inserted Contact IDs.csv`. Lookup or write errors
produce separate action error CSVs.
