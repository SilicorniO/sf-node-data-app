# Examples

The examples form a sequential Salesforce data scenario. Build first:

```bash
npm run build
```

Then run:

Each example's transform/check functions live in one shared `scripts.js` passed with
`-s`. Pass `-s` for every example that has a `scripts.js` (02, 03, 04, 06, 07, 08); it is
required whenever the config has a transform or check action.

```bash
node dist/Index.js -c examples/01-insert-accounts/conf.yaml -v examples/01-insert-accounts/accounts.csv -o examples/01-insert-accounts/output/
node dist/Index.js -c examples/02-insert-contacts/conf.yaml -s examples/02-insert-contacts/scripts.js -v examples/02-insert-contacts/contacts.csv -o examples/02-insert-contacts/output/

node examples/03-insert-opportunities/generate-xlsx.js
node dist/Index.js -c examples/03-insert-opportunities/conf.yaml -s examples/03-insert-opportunities/scripts.js -e examples/03-insert-opportunities/opportunities.xlsx -o examples/03-insert-opportunities/output/

node dist/Index.js -c examples/04-update-opportunities/conf.yaml -s examples/04-update-opportunities/scripts.js -v examples/04-update-opportunities/opportunities-update.csv -o examples/04-update-opportunities/output/
node dist/Index.js -c examples/05-export-to-csv/conf.yaml -o examples/05-export-to-csv/output/
node dist/Index.js -c examples/06-transform-only/conf.yaml -s examples/06-transform-only/scripts.js -v examples/06-transform-only/employees.csv -o examples/06-transform-only/output/

node examples/07-multi-sheet-pipeline/generate-xlsx.js
node dist/Index.js -c examples/07-multi-sheet-pipeline/conf.yaml -s examples/07-multi-sheet-pipeline/scripts.js -e examples/07-multi-sheet-pipeline/enrichment.xlsx -o examples/07-multi-sheet-pipeline/output/

node dist/Index.js -c examples/08-check-rowcount/conf.yaml -s examples/08-check-rowcount/scripts.js -v examples/08-check-rowcount/employees.csv -o examples/08-check-rowcount/output/
```

- 01: INSERT from CSV
- 02: GET, lookup TRANSFORM, and INSERT
- 03: Excel input, filtering existing rows, and INSERT
- 04: GET, lookup TRANSFORM, and UPDATE by Id
- 05: GET three Salesforce objects to CSV
- 06: standalone JavaScript TRANSFORM
- 07: header mappings, multi-sheet Excel, branching transforms, UPDATE, and INSERT
- 08: CHECK actions asserting row count and column values (standalone)

Examples 01–05 and 07 require Salesforce credentials. Examples 06 and 08 are standalone.
