# sf-data — AI Guide for Preparing an Execution

This file tells an AI everything needed to help a user build a complete `sf-data` execution:
the YAML config, transform scripts, folder usage, CLI invocation, and all parameters.

`sf-data` (bin `sfdata`) is a CLI that runs an **ordered pipeline** of actions between
CSV/Excel inputs and Salesforce, driven by **one YAML config file**. Sheets flow between
actions in memory; produced sheets are written as CSV to the output folder.

> Source of truth: the Zod schema `src/schema/ExecConfSchema.ts` and the runnable
> `examples/01..07/`. **Ignore `input/*.yaml`** — that is a deprecated, rejected format.

---

## 1. YAML config structure

Root has these keys (unknown keys are rejected); only `appConfiguration` and `actions`
carry required content. The transform script is **not** referenced in the YAML — it is
passed on the command line with `--scriptFile` (see §2 and §5):

```yaml
appConfiguration: { ... }   # global settings
sheets: [ ... ]             # optional header -> Salesforce API-name mappings
actions: [ ... ]            # ordered pipeline steps
```

### appConfiguration (all optional, defaults shown)

```yaml
appConfiguration:
  processingType: "api"                 # "api" (sync, default) | "bulk" (Bulk API v2)
  apiVersion: "58.0"                    # SF API version (examples use "63.0")
  queryApiBatchSize: 2000               # 200..2000, Query page size
  bulkApiMaxWaitSec: null               # bulk job timeout (runtime default 300)
  bulkApiPollIntervalSec: null          # bulk poll interval (runtime default 5)
  cleanOutputFolderBeforeExecution: false
  deleteErrorFilesBeforeExecution: false  # delete *-errors.csv before running
```

### sheets (optional) — rename input columns to SF API names

Applies to sheets loaded from disk. If `apiName` is omitted it defaults to `name`.
Sheet names are case-insensitive and must be unique.

```yaml
sheets:
  - name: "contacts"          # sheet = CSV filename (no ext) or Excel worksheet name
    fields:
      - name: "Account"       # header in the file
        apiName: "AccountId"  # name used from here on
```

### actions — the pipeline

Actions run **sequentially in listed order**. A sheet name produced by one action
(`outputSheet`) is consumed by a later action (`inputSheet`). Action names must be
unique (case-insensitive). An action's `errorSheet` must differ from its own in/out sheets.

**Common fields on every action:**

| Field | Default | Meaning |
|---|---|---|
| `name` | (required) | Unique logical name. No `/ \ ..` or control chars. |
| `type` | (required) | `get`/`insert`/`update`/`upsert`/`delete`/`transform`/`merge` |
| `waitBeforeSeconds` | `0` | Delay before running this action |
| `continueOnError` | `false` | If `true`, row errors don't halt the pipeline |
| `errorSheet` | `<name>-errors` | Sheet/CSV for failed rows (adds `_ErrorMessage`) |
| `errorRows` | `errors` | `errors` = only failed rows; `all` = all rows |

**Per-type parameters:**

```yaml
# GET — query Salesforce into a new sheet (no input)
- name: "Get Accounts"
  type: "get"
  outputSheet: "Accounts"       # required; replaces sheet if it exists
  query: "SELECT Id, Name FROM Account"   # required (SOQL)

# TRANSFORM — run a JS function row-by-row (function comes from the --scriptFile module)
- name: "Resolve Accounts"           # this name is the key into the shared script file
  type: "transform"
  inputSheet: "contacts"        # required
  outputSheet: "contacts-ready" # required

# INSERT — create records
- name: "Insert Contacts"
  type: "insert"
  object: "Contact"             # required (SF object API name)
  inputSheet: "contacts-ready"  # required
  outputSheet: "Inserted IDs"   # optional; columns _InputRow,Id
  fields: ["FirstName","LastName","Email","AccountId"]  # optional; must NOT include Id

# UPDATE — update by Id
- name: "Update Opps"
  type: "update"
  object: "Opportunity"
  inputSheet: "opps"
  fields: ["Id","StageName","Amount"]   # optional; if given MUST include Id. No outputSheet.

# UPSERT — insert-or-update by external id
- name: "Upsert Products"
  type: "upsert"
  object: "Product2"
  inputSheet: "products"
  externalIdField: "External_Id__c"     # required
  fields: ["External_Id__c","Name"]     # optional; if given MUST include externalIdField

# DELETE — delete by Id (sends only Id column)
- name: "Delete Old"
  type: "delete"
  object: "Account"
  inputSheet: "to-delete"               # no fields / outputSheet

# MERGE — join two sheets on a key (local, no Salesforce)
- name: "Merge Data"
  type: "merge"
  primarySheet: "base"                  # non-empty primary cells win
  secondarySheet: "extra"               # must differ from primarySheet; unmatched rows appended
  outputSheet: "merged"
  idField: "Id"                         # join key; duplicate ids throw
```

---

## 2. Transform scripts

- **One shared file** for the whole config, passed on the command line with `--scriptFile`
  (e.g. `--scriptFile ./scripts.js`, resolved against the current working directory). It is a
  CommonJS module that **exports an object keyed by action name**:
  `module.exports = { "Resolve Accounts": function (row, ctx) { ... }, ... }`.
- The key **must exactly match** the transform action's `name`. Action names are unique
  (case-insensitive), so keys never collide.
- The file may `require()` sibling modules and declare module-level `const`/helpers above
  `module.exports` to share logic and data across functions.
- **The file is loaded once and validated before any action runs** — a missing key or a
  non-function value fails preflight.

**You (the AI) may author or edit this file directly.** Write plain, human-readable code —
you do **not** need any special comment markers. The only rules the tooling relies on:

- Each transform's function is an object property whose **key is the quoted action name**
  exactly as written in the YAML (single or double quotes), e.g. `'Resolve Accounts': function (row, ctx) { ... }`.
- The value is a `function` expression (named or anonymous) or an arrow function.
- Module-level `const`/`require` above the export are fine and run once when the file loads.

The offline generator's importer parses this format by matching each YAML transform name to
its object key, so a file you write by hand loads straight into the per-action editors. One
caveat when a user then re-exports from the generator UI: each function is edited in isolation,
so **module-level `const`s and `require`s at the top of the file are not carried back into the
per-action editors** and would be dropped on a UI round-trip. If code must be shared across
functions and the user edits in the UI, prefer a sibling module pulled in with `require()`
inside each function (or inline the shared value in each function) rather than a top-level
`const`. The CLI runs hand-written top-level declarations fine regardless.

**Signature:** `(row, context) => row | null`

- `row`: mutable object, `{ [field: string]: string }` — all values are strings, keyed by
  the mapped/API field names. Mutate it or return a new object.
- Return the row to keep it; return **`null` to drop the row**. Returning a non-object throws.
- Output columns = union of returned keys, in first-seen order.
- Per-row thrown errors are written to the action's error sheet (no crash).
- `context.lookup(sheetName, matchField, value)` → first matching row or `undefined`.
- `context.lookupAll(sheetName, matchField, value)` → array of matching rows.

**Example** (`examples/02-insert-contacts/scripts.js`):

```js
module.exports = {
  'Resolve Contact Accounts': function (row, { lookup }) {
    const account = lookup('Accounts', 'Name', row.AccountId);
    if (!account) throw new Error(`Account "${row.AccountId}" was not found.`);
    row.AccountId = account.Id;   // replace name with real SF Id
    return row;
  },
};
```

Return `null` to filter (skip) a row; derive new columns by assigning `row.NewCol = ...`.

---

## 3. Folders & files

- **Inputs** (any combination): `--csvFiles` (one or more CSVs), `--excelFile` (one workbook,
  each worksheet becomes a sheet), `--inputFolder` (scans a folder **non-recursively** for
  `.csv` and Excel `.xlsx/.xls/.xlsm/.xlsb`).
- **Sheet name** = CSV file base name (no extension) or the Excel worksheet name. Two inputs
  resolving to the same sheet name (case-insensitive) are rejected.
- **Output:** `--outputFolder` (default `./`). Every produced sheet is written as
  `<sheetName>.csv` (header row + string rows). Sheets are streamed to disk as produced.
- Intermediate sheets live in memory and are released after last use. `outputSheet` on
  insert has columns `_InputRow,Id`.
- `cleanOutputFolderBeforeExecution` refuses unsafe targets (root, home, cwd/parents, or any
  folder containing a selected input file).

Convention: keep `conf.yaml`, input CSV/Excel, and the shared transform script (e.g.
`scripts.js`, passed with `--scriptFile`) together in one folder (see `examples/`), and
point `--outputFolder` at a separate `output/` dir.

---

## 4. Execution

```bash
npm install && npm run build

# Run a config with a CSV input, writing results to ./output
# Pass --scriptFile whenever the config has a transform action.
node dist/Index.js -c examples/02-insert-contacts/conf.yaml \
  -s examples/02-insert-contacts/scripts.js \
  -v examples/02-insert-contacts/contacts.csv -o output

# Or run from TypeScript without building:
npx ts-node src/Index.ts --confFile <conf.yaml> --scriptFile <scripts.js> \
  --csvFiles <data.csv> --outputFolder output
```

Phases: load+validate YAML → prepare output folder → index inputs → field mappings + SF auth
(only if a non-transform action is in range) → run selected actions in order (streaming
output) → flush remaining sheets. Exit code 1 on failure; accepted row-errors still exit 0.

There is also an **offline YAML generator UI**: `npm run build:web` →
`dist-web/execconf_generator.html` (forms + validation). Opened as a `file://`
document it only authors config and does not execute anything; served by the
`sfdata --ui` daemon it can also run the pipeline from a browser. **The `--ui`
daemon is a human convenience — as an AI you do not need it.** Write `conf.yaml`
and the transform script directly to disk and run the CLI with `node dist/Index.js`
(or `npx ts-node src/Index.ts`) as in §4/§5; that is the supported path for you.
Each transform action edits its function in an in-browser editor; **Download** writes
both `conf.yaml` and the shared script file, and **importing** them together (select the
`.yaml` and the shared `.js` at once) preloads every transform's code automatically,
matched to each action by its quoted name key. A file written by hand or by an AI loads
the same way — no special comment markers are needed. The generator rebuilds the shared
file from the editors, so a hand-authored top-of-file `require('./helper')` or module-level
`const` is not preserved across a UI round-trip — the CLI still runs such hand-written files
fine.

---

## 5. CLI parameters

| Flag | Alias | Required | Default | Meaning |
|---|---|---|---|---|
| `--confFile <path>` | `-c` | **yes** | — | YAML config file |
| `--csvFiles <paths...>` | `-v` | no | — | One or more CSV inputs |
| `--excelFile <path>` | `-e` | no | — | One Excel workbook |
| `--inputFolder <path>` | `-i` | no | — | Scan folder (non-recursive) for CSV+Excel |
| `--scriptFile <path>` | `-s` | only if a transform exists | — | Shared CommonJS transform module (keyed by action name), resolved against cwd |
| `--outputFolder <path>` | `-o` | no | `./` | Output CSV folder |
| `--fromTask <name\|index>` | — | no | first action | Start action (name, case-insensitive, or 1-based index) |
| `--toTask <name\|index>` | — | no | last action | End action (inclusive) |

Use `--fromTask`/`--toTask` to run a sub-range of the pipeline (e.g. re-run only step 3).

---

## 6. Salesforce authentication (env vars / `.env`)

Precedence: **bearer token → client credentials → Salesforce CLI**.
Auth is only performed when the run includes a non-`transform`/`merge` action.

- **Bearer:** `SF_ACCESS_TOKEN` + `SF_INSTANCE_URL` (both required).
- **Client credentials:** `SF_CLIENT_ID` + `SF_CLIENT_SECRET` + `SF_INSTANCE_URL` (all three).
- **SF CLI fallback:** none set → uses the active org via the `sf` CLI.

Pure `transform`/`merge`-only pipelines need no Salesforce credentials.

---

## 7. Minimal complete example

Folder `myjob/` with `conf.yaml`, `contacts.csv`, and `scripts.js` (exporting a
`"Resolve Contact Accounts"` function):

```yaml
# myjob/conf.yaml
appConfiguration:
  processingType: "api"
  apiVersion: "63.0"
sheets:
  - name: "contacts"
    fields:
      - name: "AccountId"
        apiName: "AccountId"
actions:
  - name: "Get Accounts"
    type: "get"
    outputSheet: "Accounts"
    query: "SELECT Id, Name FROM Account"
  - name: "Resolve Contact Accounts"
    type: "transform"
    inputSheet: "contacts"
    outputSheet: "contacts-ready"
  - name: "Insert Contacts"
    type: "insert"
    object: "Contact"
    inputSheet: "contacts-ready"
    outputSheet: "Inserted Contact IDs"
    fields: ["FirstName","LastName","Email","Phone","Title","AccountId"]
```

```bash
node dist/Index.js -c myjob/conf.yaml -s myjob/scripts.js -v myjob/contacts.csv -o output
```

## Checklist for a complete execution

- [ ] `--confFile` points to a valid YAML with `actions`.
- [ ] Every `inputSheet` is either an input file's sheet or a prior action's `outputSheet`.
- [ ] `fields` rules honored: insert excludes `Id`; update includes `Id`; upsert includes `externalIdField`.
- [ ] If any transform exists, `--scriptFile` is passed and the shared file exports a function keyed by each transform action's `name`.
- [ ] Inputs supplied via `-v`/`-e`/`-i`; sheet names don't collide.
- [ ] SF auth env vars set if any get/insert/update/upsert/delete action runs.
- [ ] `--outputFolder` set (not a protected path if cleaning is enabled).
