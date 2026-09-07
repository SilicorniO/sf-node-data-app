# Example 04 — Update Opportunities

Requires Opportunities from example 03. The input CSV identifies rows by Name.
The pipeline GETs Salesforce Id/Name values, resolves each Id in an explicit
TRANSFORM action, then UPDATEs `Id`, `StageName`, and `Amount`.

```bash
node dist/Index.js \
  -c examples/04-update-opportunities/conf.yaml \
  -v examples/04-update-opportunities/opportunities-update.csv \
  -o examples/04-update-opportunities/output/
```

UPDATE requires `Id` in both the transformed input and the configured `fields`
list. It has no normal output sheet; errors are written separately.
