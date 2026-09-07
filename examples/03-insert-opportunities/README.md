# Example 03 — Insert Opportunities from Excel

Requires the Accounts from example 01. Generate the Excel workbook, then run:

```bash
node examples/03-insert-opportunities/generate-xlsx.js
node dist/Index.js \
  -c examples/03-insert-opportunities/conf.yaml \
  -e examples/03-insert-opportunities/opportunities.xlsx \
  -o examples/03-insert-opportunities/output/
```

The pipeline GETs Accounts and existing Opportunities into separate sheets.
`prepare-opportunities.js` omits rows whose Name already exists and resolves each
new row's AccountId. The final INSERT writes successful Salesforce IDs to a
separate mapping CSV.
