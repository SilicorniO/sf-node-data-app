# Example 06 — Transform Only (no Salesforce connection)

**API mode:** N/A — no Salesforce operations  
**Input format:** CSV  
**Salesforce objects:** None  
**Prerequisites:** None — fully self-contained, no `.env` file needed.

## What this example does

Demonstrates the transformation engine in isolation. The pipeline reads a CSV file
of employee data, applies five field transformations, and writes the result to a
new CSV — without connecting to Salesforce at all.

This is the fastest way to test transformation logic before wiring it into a
full import pipeline.

## Files

| File | Description |
|---|---|
| `employees.csv` | 5 employee records with name, department, salary, and hire date |
| `conf.yaml` | Single transform action with five field expressions |
| `output/` | Result CSV written here after execution |

## Transformations applied

| Output field | Expression | Description |
|---|---|---|
| `FullName` | `FirstName + (MiddleName ? ' ' + MiddleName : '') + ' ' + LastName` | Concatenates name parts, omitting middle name if blank |
| `SalaryBand` | Ternary on `Salary` | `< 70k → Junior`, `70k–90k → Mid`, `> 90k → Senior` |
| `Role` | Ternary on `IsManager` | `true → Manager`, `false → Individual Contributor` |
| `YearsOfService` | `Math.floor((now - HireDate) / year_ms)` | Tenure in full years from hire date to today |
| `AnnualBonus` | `Salary × (10% if manager, 5% otherwise)` | Computed bonus amount |

## How to run

```bash
node dist/Index.js \
  -c examples/06-transform-only/conf.yaml \
  -v examples/06-transform-only/employees.csv \
  -o examples/06-transform-only/output/
```

No Salesforce credentials are required because there are no `exportAction` or
`importAction` entries in the config.

## Expected output

`output/employees.csv` — the original columns plus the five new computed fields.

## Key concepts

- **`${FieldName}` syntax** — substitutes the current row's value for that field into the expression string before `eval()`.
- **New fields** — if a `name` in `fieldsConf` does not exist as a column in the CSV, the column is automatically created (appended) with the computed value.
- **Full JavaScript** — the transformation string is evaluated as a JavaScript expression after variable substitution. `Math`, `Date`, `Number`, `String`, and all built-in JS globals are available.
- **No SF credentials needed** — the `appConfiguration` block is still required by the parser, but its values are only used when `exportAction` or `importAction` are present.
