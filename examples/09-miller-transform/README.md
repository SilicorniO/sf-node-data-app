# Example 09 — Miller (mlr) Transform

Runs without Salesforce credentials. Transforms CSVs with
[Miller](https://miller.readthedocs.io) (`mlr`), which must be installed and on
your `PATH`.

You write only the Miller **verb chain** in `command`. The app supplies
`mlr --csv`, the input file(s), and writes the result to the output folder — so
never put `mlr`, `--csv`, or file paths in `command`.

```bash
node dist/Index.js \
  -c examples/09-miller-transform/conf.yaml \
  -v examples/09-miller-transform/employees.csv \
  -o examples/09-miller-transform/output/
```

Two chained Miller actions:

1. **Sort Employees By Salary** — `sort -nr Salary` sorts `employees` descending
   by salary into `employees-sorted.csv`.
2. **Top Earners In Engineering** — reads the sorted sheet, keeps Engineering rows
   and selects three columns into `engineering-top-earners.csv`.

Each `outputSheet` is written to the output folder and is available to later
actions, exactly like `transform` and `merge` outputs. Multiple `inputSheets` are
passed to `mlr` in order, which enables join-style verbs.
