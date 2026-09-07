# Examples

The examples form a sequential Salesforce data scenario. Build first:

```bash
npm run build
```

Then run:

```bash
node dist/Index.js -c examples/01-insert-accounts/conf.yaml -v examples/01-insert-accounts/accounts.csv -o examples/01-insert-accounts/output/
node dist/Index.js -c examples/02-insert-contacts/conf.yaml -v examples/02-insert-contacts/contacts.csv -o examples/02-insert-contacts/output/

node examples/03-insert-opportunities/generate-xlsx.js
node dist/Index.js -c examples/03-insert-opportunities/conf.yaml -e examples/03-insert-opportunities/opportunities.xlsx -o examples/03-insert-opportunities/output/

node dist/Index.js -c examples/04-update-opportunities/conf.yaml -v examples/04-update-opportunities/opportunities-update.csv -o examples/04-update-opportunities/output/
node dist/Index.js -c examples/05-export-to-csv/conf.yaml -o examples/05-export-to-csv/output/
node dist/Index.js -c examples/06-transform-only/conf.yaml -v examples/06-transform-only/employees.csv -o examples/06-transform-only/output/

node examples/07-multi-sheet-pipeline/generate-xlsx.js
node dist/Index.js -c examples/07-multi-sheet-pipeline/conf.yaml -e examples/07-multi-sheet-pipeline/enrichment.xlsx -o examples/07-multi-sheet-pipeline/output/
```

- 01: INSERT from CSV
- 02: GET, lookup TRANSFORM, and INSERT
- 03: Excel input, filtering existing rows, and INSERT
- 04: GET, lookup TRANSFORM, and UPDATE by Id
- 05: GET three Salesforce objects to CSV
- 06: standalone JavaScript TRANSFORM
- 07: header mappings, multi-sheet Excel, branching transforms, UPDATE, and INSERT

Examples 01–05 and 07 require Salesforce credentials. Example 06 is standalone.
