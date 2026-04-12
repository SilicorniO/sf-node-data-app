# SFNode Data App

A Node.js/TypeScript CLI tool for loading tabular data (Excel or CSV) into Salesforce
via ETL pipelines defined in YAML. Supports insert, update, upsert, and delete
operations via the **Bulk API v2** and the **sObject Collections REST API**, with
field transformations, cross-sheet lookups, and automatic rollback on failure.

---

## Table of contents

1. [How it works](#how-it-works)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Salesforce authentication](#salesforce-authentication)
5. [CLI usage](#cli-usage)
6. [Configuration reference](#configuration-reference)
7. [Transformation expressions](#transformation-expressions)
8. [Output files](#output-files)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)

---

## How it works

```
Input files                  Config file (.yaml)
  CSV / Excel     ──────►   ExecConfReader
       │                         │
       ▼                         ▼
  DataSheets ◄──────────── ExecConf (actions, sheets, appConfig)
  (in memory)
       │
       │   For each action (in order):
       │
       ├─ 1. CopySheetAction  ─── filter rows / copy columns to a new sheet
       │
       ├─ 2. ExportAction     ─── SOQL query → Salesforce → merge into sheet
       │
       ├─ 3. TransformAction  ─── eval() JS expressions, cross-sheet lookups
       │
       └─ 4. ImportAction     ─── send sheet to Salesforce (insert/update/upsert/delete)
                                        │
                                        ▼
                                 Output CSVs (one per sheet)
                                 with Id and error columns added
```

**Key design points:**

- All data is held in memory as named `DataSheet` objects (header row + data rows).
- When CSV files are loaded, the sheet name equals the filename without extension.
- When an Excel file is loaded, each tab becomes a separate `DataSheet`.
- Field name translation (human-readable → API name) is applied once at load time
  using the `sheets` config block.
- For `action: "insert"`, rows that already have an `Id` value are automatically
  skipped, enabling idempotent re-runs.
- For `action: "upsert"`, the `uniqueField` becomes the Bulk API `externalIdFieldName`
  and must be a Salesforce external ID field.

---

## Prerequisites

- Node.js ≥ 18
- A Salesforce org with API access enabled
- One of the two supported authentication methods configured (see below)

---

## Installation

```bash
git clone <repo-url>
cd sfnodedataapp
npm install
npm run build        # compiles TypeScript to dist/
```

For development, skip the build and use `ts-node` directly.

---

## Salesforce authentication

The app supports two authentication modes. Set the appropriate environment variables
in a `.env` file at the project root (never commit this file).

**Priority:** if `SF_ACCESS_TOKEN` is present it takes precedence over
`SF_CLIENT_ID` / `SF_CLIENT_SECRET`.

---

### Option A — Connected App (Client Credentials flow)

A server-to-server OAuth 2.0 flow. The app exchanges a Consumer Key + Secret for
an access token automatically and transparently refreshes it when it expires
(tokens are reused for up to 1 hour).

#### Salesforce setup

1. In Salesforce Setup go to **App Manager → New Connected App**.
2. Enable **OAuth Settings**.
3. Add the scope **Manage user data via APIs (api)**.
4. Enable **Enable Client Credentials Flow**.
5. After saving, note the **Consumer Key** (`SF_CLIENT_ID`) and
   **Consumer Secret** (`SF_CLIENT_SECRET`).
6. In **Manage Connected Apps**, assign a **Run As** user that has the required
   object and field permissions.

#### `.env` variables

```env
SF_CLIENT_ID=3MVG9...your_consumer_key...
SF_CLIENT_SECRET=ABC123...your_consumer_secret...
SF_INSTANCE_URL=https://your-org.my.salesforce.com
```

---

### Option B — Bearer Token (pre-obtained access token)

Use an access token you already have. This token can come from any Salesforce
OAuth flow or a SOAP login session:

| Source | How to obtain the token |
|---|---|
| **OAuth Authorization Code / JWT Bearer** | The `access_token` field in the token response |
| **SOAP Login** (`login.salesforce.com/services/Soap/c/…`) | The `<sessionId>` element in the SOAP response |
| **Salesforce CLI** | `sf org display --target-org <alias> --json \| jq .result.accessToken` |
| **Workbench / other tools** | Any tool that surfaces the session/access token |

The token is passed directly as the `Authorization: Bearer <token>` header on
every API call. It is **not** refreshed automatically — if it expires during a
long run, re-run the tool with a fresh token.

#### `.env` variables

```env
SF_ACCESS_TOKEN=00D...your_access_token...
SF_INSTANCE_URL=https://your-org.my.salesforce.com
```

> `SF_CLIENT_ID` and `SF_CLIENT_SECRET` are not needed in this mode and are
> ignored if `SF_ACCESS_TOKEN` is present.

---

### Choosing between the two modes

| | Connected App | Bearer Token |
|---|---|---|
| Requires Connected App setup | Yes | No |
| Token is managed automatically | ✓ (refreshed every hour) | ✗ (caller's responsibility) |
| Works in fully automated pipelines | ✓ | ✓ (if token is injected by CI/CD) |
| Good for quick / interactive runs | ✗ | ✓ |

---

## CLI usage

```bash
# Development
ts-node src/Index.ts -c <conf.yaml> [options]

# Production (after npm run build)
node dist/Index.js -c <conf.yaml> [options]

# Standalone executable (no Node.js required)
./dist-exec/sf-data-macos -c <conf.yaml> [options]
```

### Options

| Flag | Long form | Description |
|---|---|---|
| `-c` | `--confFile <path>` | **(Required)** Path to the YAML config file |
| `-e` | `--excelFile <path>` | Path to an Excel `.xlsx` input file |
| `-v` | `--csvFiles <paths...>` | One or more CSV input files (space-separated) |
| `-o` | `--outputFolder <path>` | Output directory for result CSVs (default: `./`) |

### Examples

```bash
# Insert from a single CSV
node dist/Index.js -c conf.yaml -v data.csv -o output/

# Insert from an Excel file (all sheets are loaded)
node dist/Index.js -c conf.yaml -e data.xlsx -o output/

# Insert from multiple CSV files
node dist/Index.js -c conf.yaml -v file1.csv file2.csv -o output/

# Export only (no input file needed)
node dist/Index.js -c export-conf.yaml -o output/
```

---

## Configuration reference

The YAML config file controls the entire pipeline. All sections except `actions` are optional.

### Top-level structure

```yaml
appConfiguration:   # API settings (optional — defaults shown below)
  ...

sheets:             # Column name → API name mappings (optional)
  - ...

actions:            # Ordered list of pipeline steps (required)
  - ...
```

---

### `appConfiguration`

Controls how the app connects to Salesforce and handles errors.

```yaml
appConfiguration:
  processingType: "bulk"       # "bulk" (Bulk API v2) or "api" (sObject Collections)
  bulkApiMaxWaitSec: 300       # Max seconds to wait for a Bulk API job to complete
  bulkApiPollIntervalSec: 5    # Seconds between Bulk API job status polls
  stopOnError: true            # Stop all actions if one fails
  rollbackOnError: true        # Auto-delete successfully inserted records on failure
  apiVersion: "63.0"           # Salesforce API version
```

| Field | Default | Description |
|---|---|---|
| `processingType` | `"bulk"` | `"bulk"` for Bulk API v2 (async, large volumes); `"api"` for sObject Collections (sync, up to 200 records/batch) |
| `bulkApiMaxWaitSec` | `null` | Maximum wait time for a Bulk API job. Throws if exceeded |
| `bulkApiPollIntervalSec` | `null` | Polling interval for Bulk API job status |
| `stopOnError` | `false` | Stop the pipeline when any action returns errors |
| `rollbackOnError` | `false` | When `stopOnError` is true, automatically delete all records inserted earlier in the same run |
| `apiVersion` | `"58.0"` | Salesforce REST/Bulk API version |

---

### `sheets`

Maps human-readable column headers (as they appear in Excel/CSV) to Salesforce API
field names. Applied once at load time. Only include columns that need renaming.

```yaml
sheets:
  - name: "Sheet Name"         # Must match the Excel tab name or CSV filename (without extension)
    fields:
      - name: "Human Label"    # Column header in the source file
        apiName: "SF_API__c"   # Salesforce API field name used throughout the pipeline
```

**Example:** An Excel column `"Account Name"` mapped to `AccountId` so the transform
step can populate it with a real Salesforce ID:

```yaml
sheets:
  - name: "Contacts"
    fields:
      - name: "Account Name"
        apiName: "AccountId"
```

---

### `actions`

An ordered array of pipeline steps. Each action can contain any combination of the
four sub-actions. They always run in this order: `copySheetAction` → `exportAction`
→ `transformAction` → `importAction`.

```yaml
actions:
  - name: "Action Label"          # Used in logs; also used as inputSheet if not specified
    inputSheet: "SheetName"       # DataSheet to read from (required for transform/import)
    outputSheet: "OutputSheet"    # DataSheet to write to (defaults to inputSheet)
    waitStartingTime: 0           # Seconds to wait before starting this action

    copySheetAction: ...
    exportAction: ...
    transformAction: ...
    importAction: ...
```

---

#### `copySheetAction`

Copies (and optionally filters) columns from `inputSheet` into `outputSheet`.
If `outputSheet` already exists, the copied rows are **merged** into it using
`uniqueField` as the matching key.

```yaml
copySheetAction:
  condition: "'${IsActive}' === 'true'"   # JS expression; only matching rows are copied
  uniqueField: "Name"                     # Merge key when outputSheet already exists
  copyFields:                             # Columns to copy (if empty, copies all)
    - name: "SourceColumn"               # Column name in inputSheet
      apiName: "DestinationColumn"        # Column name in outputSheet
```

---

#### `exportAction`

Runs a SOQL query against Salesforce and loads the results into `outputSheet`.
If `outputSheet` already exists in memory (e.g., loaded from a CSV), the query
results are **merged** into it using `uniqueField` as the matching key. The
existing data is treated as master — its non-empty values are never overwritten.

```yaml
exportAction:
  query: "SELECT Id, Name, Email FROM Contact WHERE IsActive = true"
  uniqueField: "Name"    # Column used to match rows during merge (optional)
```

---

#### `transformAction`

Applies JavaScript expressions to field values. Expressions are evaluated with
`eval()` after variable substitution. New fields are created automatically if the
`name` does not exist as a column.

```yaml
transformAction:
  fieldsConf:
    - name: "FieldApiName"           # Target field (existing or new)
      transformation: "<expression>" # JS expression (see below)
```

See [Transformation expressions](#transformation-expressions) for the full syntax.

---

#### `importAction`

Sends the sheet data to Salesforce. Automatically handles:

- **insert**: Rows that already have an `Id` are skipped.
- **update**: Requires `Id` to be present (populated by a prior export).
- **upsert**: Uses `uniqueField` as the Salesforce external ID field name.
- **delete**: Only the `Id` column is sent.

```yaml
importAction:
  objectName: "Account"       # Salesforce object API name
  action: "insert"            # insert | update | upsert | delete
  uniqueField: "Name"         # Used for result mapping (and as external ID for upsert)
  importFields:               # Subset of fields to send (if omitted, all columns are sent)
    - "Name"
    - "BillingCity"
```

| Field | Description |
|---|---|
| `objectName` | Salesforce object API name (e.g. `Account`, `MyObject__c`) |
| `action` | `insert`, `update`, `upsert`, or `delete` |
| `uniqueField` | Used to match result rows back to source rows. For `upsert`, this must be an external ID field in Salesforce |
| `importFields` | Explicit list of columns to send. When omitted, all non-empty columns are sent. The `Id` column is always included for update/delete |

---

## Transformation expressions

Transformation strings are JavaScript expressions evaluated with `eval()`.
Variable placeholders are substituted before evaluation.

### Variable in the current row

```
${FieldApiName}
```

Substitutes the current row's value for that field.

```yaml
# Boolean string to number
transformation: "Number('${Salary}') * 1.1"

# Conditional
transformation: "'${IsManager}' === 'true' ? 'Manager' : 'IC'"

# Date calculation
transformation: "String(Math.floor((Date.now() - new Date('${HireDate}').getTime()) / 86400000))"
```

### Cross-sheet lookup

```
${SheetName.MatchField.TargetField}
```

Finds the row in `SheetName` where `MatchField` equals **the current value of the
field being transformed**, and returns `TargetField` from that row.

```yaml
# Replace Account Name (currently in AccountId column) with the real Salesforce Id
- name: "AccountId"
  transformation: "'${Accounts.Name.Id}'"

# Look up a related record's Id using a code field
- name: "PriceBookId"
  transformation: "'${PriceBooks.Code.Id}'"
```

**How it works:** Before the transform runs, the field `AccountId` holds an account
name (e.g., `Acme Corp`). The expression `'${Accounts.Name.Id}'` searches the
`Accounts` sheet for a row where `Name == "Acme Corp"` and returns its `Id`. The
result replaces the field value.

### Computed unique key

```yaml
# Composite key for deduplication
- name: "_UniqueId"
  transformation: "'${ObjectAId}' + '|' + '${ObjectBId}'"
```

Fields prefixed with `_` are helper columns — they are included in output CSVs but
filtered out of Salesforce payloads when using `importFields`.

---

## Output files

After execution, one CSV file is written to `outputFolder` for each DataSheet
processed. Result columns are appended automatically:

| Column | When added | Description |
|---|---|---|
| `Id` | After a successful `insert` | The Salesforce record ID assigned to the new record |
| `_ErrorInsertMessage` | After `insert`, `update`, or `upsert` | Per-row error message; empty on success |
| `_ErrorRemoveMessage` | After `delete` | Per-row error message for delete failures |

---

## Examples

The [`examples/`](./examples/) folder contains six sequential examples that demonstrate
every major feature using a consistent dataset (Accounts → Contacts → Opportunities).

| # | Example | Concepts |
|---|---|---|
| 01 | [Insert Accounts](./examples/01-insert-accounts/) | Simple insert, Bulk API v2, rollback |
| 02 | [Insert Contacts](./examples/02-insert-contacts/) | Multi-step, cross-sheet lookup, sObject Collections |
| 03 | [Insert Opportunities](./examples/03-insert-opportunities/) | Excel input, idempotent insert, Bulk API v2 |
| 04 | [Update Opportunities](./examples/04-update-opportunities/) | Export-then-update, master/secondary merge |
| 05 | [Export to CSV](./examples/05-export-to-csv/) | Pure SOQL export, no input file |
| 06 | [Transform Only](./examples/06-transform-only/) | JS expressions, no Salesforce required |

See [`examples/README.md`](./examples/README.md) for the full sequence and quick-start commands.

---

## Troubleshooting

### Authentication errors

**Client Credentials flow**
- Verify `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, and `SF_INSTANCE_URL` are set correctly in `.env`.
- Ensure the Connected App has **Client Credentials Flow** enabled and a **Run As** user
  assigned with the required object and field permissions.
- Check that `SF_INSTANCE_URL` does not have a trailing slash.

**Bearer Token flow**
- Verify the token is still valid and has not expired (Salesforce access tokens expire
  after ~2 hours by default; SOAP session IDs after the org's session timeout setting).
- Make sure `SF_INSTANCE_URL` matches the org the token was issued for.
- If `SF_ACCESS_TOKEN` is set in `.env`, it takes priority over `SF_CLIENT_ID` / `SF_CLIENT_SECRET`.
  Remove or comment out `SF_ACCESS_TOKEN` to switch back to Client Credentials mode.

### `Sheet "X" not found`

- Confirm the `inputSheet` name in the config matches the Excel tab name or the
  CSV filename (without `.csv`).
- Sheet names are case-sensitive.

### `Value "X" not found in sheet "Y" and field "Z"`

- A cross-sheet lookup failed because the lookup value was not found in the target sheet.
- Check that the referenced sheet was populated by a prior action (export or CSV load).
- Check for trailing spaces or encoding differences between the CSV and the lookup sheet.

### Bulk API job times out

- Increase `bulkApiMaxWaitSec` in `appConfiguration`.
- For very large files, also increase `bulkApiPollIntervalSec` to reduce API calls.

### Records are duplicated on re-run

- Add an `exportAction` before the `importAction` to fetch existing records.
- Use `uniqueField` on the export to merge by a natural key (e.g., `Name` or `Email`).
- Rows that already have an `Id` after the merge are automatically skipped on insert.

### Rollback deletes records unexpectedly

- Rollback is triggered when `stopOnError: true` and `rollbackOnError: true` and any
  action fails. It deletes **all** records inserted earlier in the same run.
- Set `rollbackOnError: false` if you want partial results to persist on failure.
