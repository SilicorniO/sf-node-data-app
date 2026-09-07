# Example 06 — Transform Only

Runs without Salesforce credentials. `transform-employees.js` receives each CSV
row as a mutable object and adds FullName, SalaryBand, Role, YearsOfService, and
AnnualBonus fields.

```bash
node dist/Index.js \
  -c examples/06-transform-only/conf.yaml \
  -v examples/06-transform-only/employees.csv \
  -o examples/06-transform-only/output/
```

The source remains available as `employees.csv`; the transformed rows are written
to `employees-transformed.csv`. Script exceptions are captured in the transform
action's error CSV.
