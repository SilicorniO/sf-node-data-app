# Example 08 — Check

Runs without Salesforce credentials. Demonstrates the `check` action: a JavaScript
function per action name (in the shared script file) that receives its declared
input sheets and returns a boolean. Returning `true` passes; `false` is treated like
a row error — an error CSV is written and, unless `continueOnError` is set, the
pipeline stops.

- **Enough Employees** — passes only when `employees` has more than 3 rows.
- **No Placeholder Departments** — fails when any row has `XXXX` in the `Department`
  column. It sets `continueOnError: true`, so a failure records an error CSV but the
  pipeline keeps going.

```bash
node dist/Index.js \
  -c examples/08-check-rowcount/conf.yaml \
  -v examples/08-check-rowcount/employees.csv \
  -s examples/08-check-rowcount/scripts.js \
  -o examples/08-check-rowcount/output/
```

A failing check writes `<action-name>-errors.csv` (a single `_ErrorMessage` row) to
the output folder.
