# Example 05 — GET to CSV

Runs three independent GET actions through Bulk API v2 and writes Accounts,
Contacts, and Opportunities CSV files. No input files are required.

```bash
node dist/Index.js \
  -c examples/05-export-to-csv/conf.yaml \
  -o examples/05-export-to-csv/output/
```

Each GET atomically replaces its logical output sheet. A successful query with
zero records still writes an empty CSV with derived SELECT headers.
