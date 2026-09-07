# Example 07 — Multi-Sheet Pipeline

Requires Accounts and Contacts from examples 01 and 02. It demonstrates:

- two Excel worksheets loaded as logical CSV sheets
- initial human-readable header mappings to Salesforce API names
- GET lookup sheets for Accounts, Contacts, and existing Tasks
- per-row scripts that resolve IDs, filter existing records, and split normal
  versus high-priority activities
- one UPDATE action and two INSERT actions

```bash
node examples/07-multi-sheet-pipeline/generate-xlsx.js
node dist/Index.js \
  -c examples/07-multi-sheet-pipeline/conf.yaml \
  -e examples/07-multi-sheet-pipeline/enrichment.xlsx \
  -o examples/07-multi-sheet-pipeline/output/
```

`prepare-accounts.js` adds Account IDs before UPDATE.
`prepare-standard-activities.js` and `prepare-high-priority-activities.js` share
lookup logic from `activity-transform.js`; returning `null` filters a row from
that output branch.
