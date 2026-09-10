---
name: build-config
description: Author or edit an sf-data pipeline configuration (conf.yaml). Use when asked to create, build, generate, or scaffold a sf-data config / conf.yaml / pipeline, or to add/modify an action (get, insert, update, upsert, delete, transform, merge, check). Produces a valid config accepted by src/schema/ExecConfSchema.ts.
---

# Build an sf-data `conf.yaml`

Author a complete, schema-valid pipeline configuration. The full spec is
[ai/AI_GUIDE.md](../../AI_GUIDE.md) and the source of truth is the Zod schema
[src/schema/ExecConfSchema.ts](../../../src/schema/ExecConfSchema.ts). This skill is
the fast path; open those when a detail here is not enough.

A companion skill, **build-script**, authors the shared `scripts.js` needed by
`transform` and `check` actions.

## Interview the user (in this order)

Resolve each before writing YAML; each answer constrains the next.

1. **Inputs & sheets.** Which CSV/Excel files feed the pipeline? A sheet name = CSV
   base name (no extension) or Excel worksheet name. Do any input columns need renaming
   to Salesforce API names? If so add a `sheets` mapping (see below).
2. **Ordered actions.** What must happen, in order? Actions run top-to-bottom; an
   `outputSheet` produced by one action is consumed by a later action's `inputSheet`.
3. **Per-action fields.** For each action pick the type and apply its field rules (below).
4. **Processing & auth.** `processingType`: `api` (sync, default), `bulk` (Bulk API v2),
   or `auto` (per-action by record count, cutover at `autoBulkThreshold`, default 10000).
   Auth is resolved separately at runtime (env vars → Salesforce CLI); it is only needed
   if a non-offline action runs.
5. **Error handling.** `continueOnError`, `errorSheet`, `errorRows` per action (defaults
   below).

## Structure

```yaml
appConfiguration: { ... }   # optional; all keys have defaults
sheets: [ ... ]             # optional header -> API-name mappings (disk sheets only)
actions: [ ... ]            # ordered pipeline (the only content that really matters)
```

Root keys other than these three are rejected. Every action object is `.strict()` — no
unknown keys.

### appConfiguration (all optional; defaults from the schema)

```yaml
appConfiguration:
  processingType: "api"        # "api" (default) | "bulk" | "auto"
  autoBulkThreshold: 10000     # auto cutover: >= this many records -> bulk
  apiVersion: "58.0"           # default 58.0; the shipped examples pin "63.0"
  queryApiBatchSize: 2000      # 200..2000
  bulkApiMaxWaitSec: null      # runtime default 300
  bulkApiPollIntervalSec: null # runtime default 5
  cleanOutputFolderBeforeExecution: false
  deleteErrorFilesBeforeExecution: false
```

### sheets (optional) — rename input columns to API names

Applies only to sheets loaded from disk. `apiName` defaults to `name`. Sheet names are
case-insensitive and must be unique.

```yaml
sheets:
  - name: "contacts"          # the file's sheet
    fields:
      - name: "Account"       # header in the file
        apiName: "AccountId"  # name used from here on
```

## Common action fields (every action)

| Field | Default | Rule |
|---|---|---|
| `name` | required | Unique (case-insensitive). No `/ \ ..` or control chars. |
| `type` | required | One of the 8 types below. |
| `waitBeforeSeconds` | `0` | Delay before running. |
| `continueOnError` | `false` | If `true`, row errors don't halt the pipeline. |
| `errorSheet` | `<name>-errors` | Must differ from this action's own in/out sheets. |
| `errorRows` | `errors` | `errors` = only failed rows; `all` = every row. |

## The 8 action types and their field rules

```yaml
# GET — SOQL into a new sheet (no input). Atomically replaces outputSheet.
- name: "Get Accounts"
  type: "get"
  outputSheet: "Accounts"        # required
  query: "SELECT Id, Name FROM Account"   # required

# INSERT — create records.
- name: "Insert Contacts"
  type: "insert"
  object: "Contact"              # required
  inputSheet: "contacts-ready"   # required
  outputSheet: "Inserted IDs"    # optional; columns _InputRow,Id
  fields: ["FirstName","LastName","Email"]  # optional; if given must NOT contain Id

# UPDATE — update by Id. No outputSheet.
- name: "Update Opps"
  type: "update"
  object: "Opportunity"
  inputSheet: "opps"
  fields: ["Id","StageName","Amount"]   # optional; if given MUST contain Id

# UPSERT — insert-or-update by external id. No outputSheet.
- name: "Upsert Products"
  type: "upsert"
  object: "Product2"
  inputSheet: "products"
  externalIdField: "External_Id__c"     # required
  fields: ["External_Id__c","Name"]     # optional; if given MUST contain externalIdField

# DELETE — delete by Id (sends only the Id column). No fields / outputSheet.
- name: "Delete Old"
  type: "delete"
  object: "Account"
  inputSheet: "to-delete"

# TRANSFORM — run a JS function row-by-row. Needs a --scriptFile function keyed by this name.
- name: "Resolve Accounts"
  type: "transform"
  inputSheet: "contacts"         # required
  outputSheet: "contacts-ready"  # required

# MERGE — local join, no Salesforce. Offline.
- name: "Merge Data"
  type: "merge"
  primarySheet: "base"           # non-empty primary cells win
  secondarySheet: "extra"        # must differ from primarySheet; unmatched rows appended
  outputSheet: "merged"
  idField: "Id"                  # join key; duplicate ids in either sheet throw

# CHECK — assert a condition. Offline. Needs a --scriptFile function keyed by this name.
- name: "Enough Employees"
  type: "check"
  inputSheets: ["employees"]     # one or more sheets passed to the function
  continueOnError: false         # false return -> error sheet + stop unless continueOnError
```

When `fields` is omitted on insert/update/upsert, every input column is used (insert also
sends `Id` if present). `transform` and `check` require the shared script file — see the
**build-script** skill.

## After writing

1. Re-check every field rule against the tables above (and the schema if unsure).
2. If any `transform`/`check` action exists, ensure a matching function exists in the
   shared script (`--scriptFile`), keyed by the exact action `name`.
3. Validate & run (see [ai/AI_GUIDE.md](../../AI_GUIDE.md) §4):
   ```bash
   node dist/Index.js -c conf.yaml -s scripts.js -i <inputFolder> -o output
   ```
   `-s` is required only when a transform or check action exists. Use `--fromTask` /
   `--toTask` to run a sub-range.

A ready-to-edit skeleton is in [templates/conf.yaml](templates/conf.yaml).
