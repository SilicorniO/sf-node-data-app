---
name: build-script
description: Author or edit the shared sf-data script module (scripts.js) that holds transform and check functions. Use when asked to write, build, or fix a transform function, a check function, scripts.js, or a --scriptFile module for an sf-data pipeline. Encodes the exact function signatures and the lookup context.
---

# Build an sf-data script module (`scripts.js`)

Author the single shared CommonJS module that provides the JavaScript functions for a
pipeline's `transform` and `check` actions. Full spec: [ai/AI_GUIDE.md](../../AI_GUIDE.md)
§2. Source of truth: [src/processor/TransformScriptRunner.ts](../../../src/processor/TransformScriptRunner.ts).

The companion **build-config** skill authors the `conf.yaml` these functions serve.

## The module contract

- **One file for the whole config**, passed on the CLI with `--scriptFile` / `-s`
  (resolved against the current working directory). Required whenever any `transform`
  **or** `check` action exists.
- It exports an object **keyed by action `name`** — the key must match the YAML action
  name exactly (single or double quotes are fine):

  ```js
  module.exports = {
    'Resolve Contact Accounts': function (row, context) { /* transform */ },
    'Enough Employees': function (sheets) { /* check */ },
  };
  ```

- Loaded once and validated before any action runs: a missing key or a non-function
  value fails preflight (no actions or output happen).
- Module-level `require()` / `const` above the export run once and are fine for the CLI.
  Caveat: if the user later round-trips through the offline generator UI, each function is
  edited in isolation and **top-level `const`/`require` are dropped** — so prefer a sibling
  module pulled in with `require()` inside each function, or inline shared values.

## Transform functions — `(row, context) => row | null`

- `row` is a **mutable object**, `{ [field: string]: string }` — every value is a string,
  keyed by the mapped/API field name.
- Mutate `row` (add/change/delete keys) or return a new object. **Return the row to keep
  it; return `null` to drop it.** Returning a non-object throws.
- Output columns = union of returned keys, in first-seen order. Values are stringified.
- A per-row `throw` is caught and written to the action's error sheet — it does not crash
  the run.

```js
'Resolve Contact Accounts': function (row, { lookup }) {
  const account = lookup('Accounts', 'Name', row.AccountId);
  if (!account) throw new Error(`Account "${row.AccountId}" was not found.`);
  row.AccountId = account.Id;   // replace name with the real Salesforce Id
  return row;
},
```

## Check functions — `(sheets, context) => boolean`

**Different shape from transforms — do not confuse the two.**

- `sheets` is an object keyed by the action's `inputSheets`. Each value is a **`DataSheet`**:

  ```ts
  { name: string; fieldNames: string[]; data: string[][] }
  ```

  `data` rows are **arrays** (not objects). Access a column positionally:
  `sheet.fieldNames.indexOf('Department')`.
- Return a **boolean**. A non-boolean return is a **fatal** error. Returning `false`
  writes a one-row error sheet and stops the pipeline unless `continueOnError: true`.

```js
'Enough Employees': function (sheets) {
  return sheets['employees'].data.length > 3;   // more than 3 rows
},
'No Placeholder Departments': function (sheets) {
  const sheet = sheets['employees'];
  const col = sheet.fieldNames.indexOf('Department');
  if (col < 0) return true;                      // column absent -> nothing to check
  return sheet.data.every(row => row[col] !== 'XXXX');
},
```

## The shared context (both function kinds)

`context.lookup(sheetName, matchField, value)` → first exact string match, or `undefined`.
`context.lookupAll(...)` → array of all matches. **Lookup rows are objects** (copies)
keyed by field name — unlike a check's positional `data` arrays.

## After writing

1. Every `transform`/`check` action in `conf.yaml` has a matching key here (exact name).
2. Every key is a function; transforms return `row`/`null`, checks return a boolean.
3. Run with `-s`:
   ```bash
   node dist/Index.js -c conf.yaml -s scripts.js -i <inputFolder> -o output
   ```

A starter with one transform and one check is in [templates/scripts.js](templates/scripts.js).
