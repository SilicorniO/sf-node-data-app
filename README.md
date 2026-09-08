# sf-data

`sf-data` runs ordered data pipelines between CSV/Excel sheets and Salesforce. Each
entry in `actions` performs exactly one operation:

- `get`: run SOQL and create/replace a CSV sheet
- `insert`: insert CSV rows
- `update`: update rows by `Id`
- `upsert`: upsert rows by an external-ID field
- `delete`: delete rows by `Id`
- `transform`: run a JavaScript function for each CSV row

Actions run sequentially in YAML order. Every output is immediately available as
an input to later actions.

## Install and build

```bash
npm install
npm run build
```

## Offline YAML generator

Build the standalone configuration generator:

```bash
npm run build:web
```

Open `dist-web/execconf_generator.html` directly in a browser. It is one offline
HTML file with no CDN or sibling assets. The generator provides:

- typed forms for GET, INSERT, UPDATE, UPSERT, DELETE, and TRANSFORM
- CSV/Excel header discovery with opt-in field translations
- sheet-aware action pickers and write-field suggestions
- an offline, syntax-highlighted CommonJS transform editor with load, template,
direct-save, and download support
- live required-field and canonical Zod validation
- ordered action cards with drag-and-drop reordering
- concise live YAML preview, copy, and save-to-file with download fallback
- validated YAML import (comments and formatting are normalized)
- automatic local draft persistence and confirmed reset

The generator does not execute Salesforce operations. The Node CLI uses
environment credentials when configured; otherwise it obtains credentials from
the default org currently selected in Salesforce CLI.

Run from TypeScript:

```bash
npx ts-node src/Index.ts \
  --confFile examples/02-insert-contacts/conf.yaml \
  --scriptFile examples/02-insert-contacts/scripts.js \
  --csvFiles examples/02-insert-contacts/contacts.csv \
  --outputFolder output
```

If the pipeline has any `transform` action, pass the shared CommonJS script with
`--scriptFile` (`-s`). It is resolved relative to the current working directory and
is required only when a transform exists; the YAML no longer references it.

To run only part of a pipeline, pass `--fromTask` and/or `--toTask` with an action
name (case-insensitive) or a 1-based YAML index. The range is inclusive.

```bash
# From "Insert Contacts" through the last action
npx ts-node src/Index.ts -c conf.yaml --fromTask "Insert Contacts"

# From the first action through "Get Accounts"
npx ts-node src/Index.ts -c conf.yaml --toTask "Get Accounts"

# A middle slice, by name or by index
npx ts-node src/Index.ts -c conf.yaml --fromTask 2 --toTask "Insert Contacts"
```

If only `--toTask` is set, execution starts at the first action. If only
`--fromTask` is set, execution continues through the last action. Skipped
actions do not run, so later steps must already have the sheets they need
(from input files or a previous run's output CSVs).

Inputs can be multiple CSV files, one or more Excel workbooks, or both. An Excel
worksheet is treated as one logical CSV sheet. All generated files are CSV.

Instead of listing every file, pass `--inputFolder` (`-i`) to read every CSV and
Excel file in a folder (non-recursively). It can be combined with `--csvFiles`
and `--excelFile`; all resolved inputs are merged.

```bash
npx ts-node src/Index.ts \
  --confFile examples/02-insert-contacts/conf.yaml \
  --inputFolder examples/02-insert-contacts \
  --outputFolder output
```

Sheet names come from file names (worksheet names for Excel), so two inputs that
resolve to the same sheet name are rejected with an error.

Input sheets are read lazily to keep memory bounded on large pipelines: a CSV
file or Excel worksheet is loaded only when an action first needs it, and is
released once the last action that uses it has run. Each output sheet is written
to CSV the moment its action produces it, rather than accumulating every sheet
until the end. Field mappings are applied to a sheet as it loads.

A transform can still read another sheet at runtime with `context.lookup` /
`lookupAll`; a file-backed sheet that was already released is reloaded from disk
on demand, and sheets produced in-memory (from `get`, `merge`, or another
transform) are kept until the last transform in the run has executed.

Because inputs are released after use, a raw input sheet is no longer echoed to
the output folder unless an action reads and re-emits it.

Execution is reported as six explicit phases:

1. Load and validate the YAML configuration.
2. Optionally clean the output folder or previous error files.
3. Index the input CSV files and Excel worksheets (sheets load on first use).
4. Prepare field mappings and authentication.
5. Precheck and execute the selected action range sequentially in YAML order,
  writing each produced sheet as CSV as soon as it is ready.
6. Flush any sheets still resident in memory as CSV.

If an action fails at runtime, sheets already produced were written as they
completed, and phase 6 still flushes what remains, so successful intermediate
results and error sheets are not lost. Configuration and transform-script
precheck failures stop before any output is written.

## Authentication

Salesforce CLI active org:

```bash
sf config set target-org=my-org-alias
```

When no environment credentials are present, the CLI automatically resolves the
active org access token and instance URL with `sf org display --json` and
`sf org auth show-access-token --json`. Authentication is independent of
`processingType` and is verified before the first pipeline action executes.

Bearer token:

```bash
export SF_ACCESS_TOKEN="..."
export SF_INSTANCE_URL="https://your-domain.my.salesforce.com"
```

Client credentials:

```bash
export SF_CLIENT_ID="..."
export SF_CLIENT_SECRET="..."
export SF_INSTANCE_URL="https://your-domain.my.salesforce.com"
```



## Configuration

```yaml
appConfiguration:
  processingType: api
  bulkApiMaxWaitSec: 300
  bulkApiPollIntervalSec: 5
  apiVersion: "63.0"

sheets:
  - name: contacts
    fields:
      - name: Account Name
        apiName: AccountId

actions:
  - type: get
    name: Get Accounts
    outputSheet: Accounts
    query: SELECT Id, Name FROM Account

  - type: transform
    name: Resolve Contact Accounts
    inputSheet: contacts
    outputSheet: contacts-ready

  - type: insert
    name: Insert Contacts
    object: Contact
    inputSheet: contacts-ready
    outputSheet: Inserted Contact IDs
    fields: [FirstName, LastName, Email, AccountId]
```

Only this schema is accepted. Old compound entries such as `exportAction`,
`transformAction`, `importAction`, `copySheetAction`, and the `objectsConf` key
are invalid.

### Application settings

- `processingType`: `api` for synchronous Query API and sObject Collections
(default), or `bulk` for Bulk API v2. Authentication is selected separately:
environment credentials take precedence, with Salesforce CLI as fallback.
- `bulkApiMaxWaitSec`: optional Bulk job timeout; default is 300 at runtime
- `bulkApiPollIntervalSec`: optional Bulk polling interval; default is 5
- `apiVersion`: Salesforce API version; defaults to `58.0`
- `queryApiBatchSize`: REST Query API page size (200–2000, default `2000`).
Synchronous GET actions use this setting, but Salesforce can still reduce
pages (for example to 250 rows). Bulk GET downloads CSV pages of up to 50,000
rows; if compound fields are rejected, it falls back to synchronous GET.
- `cleanOutputFolderBeforeExecution`: recursively delete existing output-folder
contents before loading inputs; defaults to `false`
- `deleteErrorFilesBeforeExecution`: delete existing `*-errors.csv` files and
configured custom error-sheet CSVs; defaults to `false` and is redundant when
full cleanup is enabled

For safety, full cleanup refuses the filesystem root, home directory, current
working directory, any parent of the current working directory, or a folder
containing the selected YAML/CSV/Excel inputs. Use a dedicated output subfolder.

### Sheet mappings

The optional `sheets` section translates headers on initially loaded CSV/Excel
sheets. After this initial translation, actions and scripts use only the real
field/API names.

Sheet lookup is case-insensitive. The spelling used when a sheet is first created
is retained for its output filename. Inputs whose names differ only by case are
rejected.

### Common action fields

All action types support:

- `type`: required lowercase action type
- `name`: required; unique ignoring case
- `waitBeforeSeconds`: optional delay, default `0`
- `continueOnError`: optional, default `false`
- `errorSheet`: optional logical name, default `<name>-errors`
- `errorRows`: `errors` or `all`, default `errors`

Logical action/sheet names cannot contain path separators, `..`, or control
characters.

An error sheet is created only if an error occurs. Row errors preserve the row
shape and append `_ErrorMessage`. With `errorRows: all`, all rows are included
and successful rows have a blank error message.

Fatal errors (authentication, query, missing input, invalid runtime schema) always
stop the pipeline and create one error row. Row errors finish the current action;
`continueOnError` controls whether the next action runs. Accepted row errors
produce a warning but exit with status 0.

## Action reference



### GET

```yaml
- type: get
  name: Get Accounts
  outputSheet: Accounts
  query: SELECT Id, Name FROM Account
```

GET has no sheet input: SOQL is its source. It atomically replaces the output
sheet. A successful query with no records creates an empty sheet with headers
derived from the SELECT list. With `processingType: api`, GET uses the
synchronous Query API and requests `queryApiBatchSize` rows per page, although
Salesforce can return fewer. With `processingType: bulk`, GET uses a Bulk API v2
Query job and downloads CSV results in pages of up to 50,000 rows. If Salesforce
rejects compound fields in Bulk Query, GET logs a warning and automatically
retries through the synchronous Query API.

### INSERT

```yaml
- type: insert
  name: Insert Accounts
  object: Account
  inputSheet: accounts
  outputSheet: Inserted Account IDs
  fields: [Name, Phone]
```

`fields` is optional. When omitted, every input field is used, including `Id`.
An explicit list must not contain `Id`; unselected input columns are ignored.

`outputSheet` is optional. When present, it is replaced with successful
`_InputRow,Id` mappings; `_InputRow` starts at 1 for the first data row. It may
equal `inputSheet`, in which case the input is intentionally replaced. When
omitted, returned IDs are discarded.

### UPDATE

```yaml
- type: update
  name: Update Accounts
  object: Account
  inputSheet: accounts-ready
  fields: [Id, Phone, Industry]
```

When `fields` is omitted, every input field is used. An explicit list must contain
`Id`. The input sheet must contain `Id`, and rows with blank IDs are errors.
UPDATE does not accept `outputSheet`.

### UPSERT

```yaml
- type: upsert
  name: Upsert Accounts
  object: Account
  inputSheet: accounts
  externalIdField: External_Id__c
  fields: [External_Id__c, Name, Phone]
```

When `fields` is omitted, every input field is used. An explicit list must contain
`externalIdField`. The input sheet must contain that field, and rows with a blank
external ID are errors. UPSERT does not accept `outputSheet`.

The HTML action editor's **Clear fields** control enables all-fields mode and
causes the `fields` property to be omitted from generated YAML. Fields can also
be added in bulk by pasting a header row copied from Excel (tab-separated) or
CSV (comma/semicolon-separated); duplicates are removed automatically.

### DELETE

```yaml
- type: delete
  name: Delete Accounts
  object: Account
  inputSheet: account-ids
```

DELETE sends only `Id` and does not accept `fields` or `outputSheet`. Rows with a
blank ID are errors.

### TRANSFORM

```yaml
- type: transform
  name: Resolve Account IDs
  inputSheet: contacts
  outputSheet: contacts-ready
```

Every transform function lives in one shared CommonJS module passed on the command line
with `--scriptFile` (`-s`), a trusted path resolved against the current working directory.
The module exports an object keyed by each transform action's `name`:

```js
// scripts.js
module.exports = {
  'Resolve Account IDs': function (row, { lookup, lookupAll }) {
    const account = lookup('Accounts', 'Name', row.AccountId);
    if (!account) throw new Error(`Unknown account: ${row.AccountId}`);
    row.AccountId = account.Id;
    delete row.LegacyColumn;
    return row;
  },
};
```

The shared file is loaded once and may `require()` sibling modules to share logic.

In the HTML generator, each transform action edits its own function in a
syntax-highlighted editor; **Reset to template** replaces it with the required
CommonJS function documenting fields from the selected input sheet. **Download**
writes both `conf.yaml` and the shared script file. Re-importing is a single step:
choose the `conf.yaml` and its shared script together and every transform's code is
preloaded automatically — matched to each action by name. The edited source is kept
in the local browser draft and is deliberately not embedded in YAML.

The script receives a mutable dictionary whose keys are mapped/API field names.
It can add, change, or delete fields. Return the full row (the same object or a
replacement), or `null` to omit the row. Returned values are converted to
strings, and output columns are the union of returned keys in first-seen order.

`lookup(sheetName, matchField, value)` returns the first exact string match or
`undefined`. `lookupAll` returns every exact match. Lookup rows are copies.

The shared script file is loaded before the first action. A missing file, a missing
key for a transform action, or a non-function value is a configuration preflight
failure: no actions or output generation occur.
Exceptions thrown per row are caught and written to the action error sheet using
the partially transformed row. The destination is replaced only after processing
completes.

Configured scripts run as normal trusted Node.js modules and can access Node APIs.
Only run configuration and scripts you trust.

## Output and failures

All in-memory sheets—including untouched inputs, generated outputs, and created
error sheets—are written to the output folder. Existing CSV files are replaced.

If a runtime action fails, sheets produced so far are still written, then the CLI
exits non-zero. YAML validation and transform preflight failures exit non-zero
without writing CSV files.

See `[examples/](examples/)` for runnable configurations.