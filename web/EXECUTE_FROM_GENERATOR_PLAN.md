# Execute From Generator — Plan

> **Status: implemented.** Daemon (`sfdata --ui`), auth resolution (`.env` → `sf`
> org picker → paste token), streaming run, and the generator Run tab are in place,
> with vitest coverage. One notable fix during build: `handleRun` originally resolved
> as soon as the child's listeners were attached, releasing the single-run guard
> mid-run; it now awaits the child's exit, and a concurrency test locks this in.
> A later addition (`GET /config`) auto-loads any `conf.yaml`/`scripts.js` already
> present in the daemon's folder into the generator on open; the on-disk files take
> precedence over the browser draft, reusing the existing import flow.


Run a pipeline directly from the YAML Configurator generator, watch live progress,
and see the results — without leaving the browser.

## Goal

Today the generator (`dist-web/execconf_generator.html`) only *authors* `conf.yaml`
and the transform `scripts.js`; it explicitly does not execute Salesforce operations.
This feature adds a **Run** capability: the generator hands its current configuration
to the existing Node CLI (`src/Index.ts`), which runs in the user's project folder,
and streams the CLI's live phase log back into the generator, ending with a
result summary and the list of produced output files.

The execution engine is unchanged. We are adding a thin local **daemon** that
bridges the browser to the CLI, plus UI in the generator to drive it.

## Key decisions (resolved in interview)

| Topic | Decision |
|-------|----------|
| Transport to Salesforce | Reuse the Node CLI as-is; the generator does **not** call Salesforce from the browser. No CORS work. |
| Runtime bridge | A new local **daemon** (Node) started per project folder. |
| Serving the generator | The daemon **also serves the generator page** at `http://localhost:<port>`. This makes the page same-origin with the daemon API (no CORS / null-origin issues). The standalone `file://` HTML still works for authoring, with Run disabled unless it can reach the daemon. |
| Daemon working dir | The folder where it is started == the project folder that holds inputs, and where `conf.yaml` / `scripts.js` are written and `output/` is produced. Running from the generator is equivalent to "save the YAML + script, then run the CLI here". |
| CLI args | Fixed conventions relative to the daemon cwd: `--confFile conf.yaml`, `--inputFolder .`, `--outputFolder ./output`, and `--scriptFile scripts.js` **only when a transform action exists**. |
| Config + script sync | Before each run the daemon writes `conf.yaml` from the browser's current YAML. It writes `scripts.js` **only if the pipeline has a transform action** (never clobbers `scripts.js` for non-transform pipelines). |
| Input data files | Already on disk in the project folder (the `examples/` layout). Not uploaded from the browser — they can be gigabytes. |
| Task range | Expose `--fromTask` / `--toTask` pickers in the generator (it already renders ordered action cards). |
| Authentication | Resolved by the daemon from the local environment (see **Authentication resolution** below). All paths ultimately hand the CLI a bearer `SF_ACCESS_TOKEN` + `SF_INSTANCE_URL`, matching the CLI's existing env-based bearer path — **no CLI changes**. |
| Auth precedence | `.env` first → `sf` CLI authorized orgs (picker) → ask the user to paste a token. |
| sf org selection | Daemon lists `sf` orgs and offers a **picker**; the user chooses which org to run against (not limited to the active org). |
| sf token + expiry | Daemon fetches a token per run via `sf org auth show-access-token --target-org <picked>`. If `sf` errors (not logged in / expired), surface it in the UI and fall back to asking for a pasted token. Always fresh; no expiry guessing. |
| Org → CLI | Daemon resolves the token itself and spawns the CLI with `SF_ACCESS_TOKEN`/`SF_INSTANCE_URL` for the picked org. The user's global `sf config` is never mutated. |
| Token flow | Sent per-run (or resolved per-run) to the daemon, set as env only for that single CLI child process. Not written to disk. |
| Token persistence (browser) | A **pasted** token + instance URL persist in the browser draft for the **session only** (`sessionStorage`), separate from the long-lived config draft (`localStorage`). Tokens resolved from `.env`/`sf` are never sent to the browser. |
| Daemon port | Configurable via `--port` flag (valid alongside `--ui`) or `PORT` env; default `3111` when neither is set. The served generator infers the port from its own location, so it always targets the right daemon. |
| Results returned | **List only**: output file names + row counts (parsed from the CLI's existing `+ file.csv: N row(s)` stdout lines). No file contents returned — files may be GB-sized and stay on disk. |
| Live output | Stream the CLI's six-phase stdout live, then show a pass/fail summary and the output file list. |
| Streaming mechanism | Chunked HTTP response + `ReadableStream` (`response.body.getReader()`). Simplest thing that streams live and handles multi-minute runs; no extra dependency. |
| Concurrency | One run at a time. Daemon rejects a new run while one is active (shared `output/` folder). Generator disables Run during a run. |
| Connection status | Fixed default port (proposed `3111`). Generator shows daemon connection status; when unreachable it disables Run and hints `npm run daemon`. |
| Confirmation | Before running, the generator shows a confirm dialog summarizing the target instance-URL host, action count, and selected range. |
| Invocation | The daemon is **not** a separate binary. It is started by passing **`--ui`** to the existing CLI (`sfdata --ui`). Without `--ui`, the CLI behaves exactly as today (one-shot pipeline). Daemon code lives in `src/daemon/`, invoked from `src/Index.ts` when `--ui` is set. |
| Daemon flags | In `--ui` mode only **`--port`** (and the current working directory) are meaningful. All pipeline flags (`-c/--confFile`, `-i`, `-o`, `-s`, `--fromTask`, `--toTask`) are irrelevant — those inputs come per-run from the browser — and `--confFile` is **not required** in `--ui` mode (today it is a required option). |
| Execution strategy | Daemon **spawns the built CLI** (`dist/Index.js`) as a child process with flags + env, so a run behaves identically to manual CLI use. (Falls back to `ts-node src/Index.ts` in dev.) |
| Tests | Vitest daemon unit/integration tests. |

## Architecture

```
Started with: sfdata --ui [--port <n>]   (in the project folder)

Browser (generator page, served from localhost:<port>, same-origin)
  │  1. POST /run  { yaml, script?, token, instanceUrl, fromTask?, toTask? }
  ▼
Daemon (Node, cwd = project folder, one run at a time)
  │  2. write ./conf.yaml   (always)
  │     write ./scripts.js  (only if a transform action exists)
  │  3. spawn CLI child:
  │        dist/Index.js -c conf.yaml -i . -o ./output [-s scripts.js]
  │                      [--fromTask X] [--toTask Y]
  │        env: SF_ACCESS_TOKEN, SF_INSTANCE_URL (this child only)
  │  4. stream child stdout/stderr → chunked HTTP response (line by line)
  │  5. on exit: append a trailer with exit status + parsed output-file list
  ▼
Browser
     reads the stream via response.body.getReader():
       - live log panel (phases 1–6)
       - final summary (success / accepted-row-errors / failed)
       - output file list (name + row count), files remain on disk
```

### Why this is CORS-free
Because the daemon serves the generator page, the page origin is
`http://localhost:<port>` and the `/run` and `/status` calls are same-origin.
The standalone `file://` build still works for authoring only.

## Authentication resolution

The daemon resolves credentials at run time, in this order, and reports to the UI
which source it will use so the user can override:

1. **`.env` in the daemon cwd** — if it defines a usable credential
   (`SF_ACCESS_TOKEN`+`SF_INSTANCE_URL`, or `SF_CLIENT_*`), use it. This mirrors the
   CLI's existing env-first precedence (the CLI itself calls `dotenv.config()`), so
   the daemon can simply let the CLI consume `.env` when present.
2. **`sf` CLI authorized orgs** — if no `.env` credential, the daemon lists orgs
   (`sf org list --json`). If one or more are authorized, the UI shows an **org
   picker**. When the user picks one and runs, the daemon fetches a fresh token
   (`sf org auth show-access-token --target-org <picked> --json`) plus the instance
   URL, and spawns the CLI with those as `SF_ACCESS_TOKEN`/`SF_INSTANCE_URL`.
   - If `sf` is not installed, returns no orgs, or `show-access-token` fails
     (not logged in / **expired**), the daemon reports that state and the UI
     falls back to **paste a token**.
3. **Paste a token** — the user enters instance URL + bearer token in the UI. Used
   as-is for that run's env. Persisted only in `sessionStorage`.

The user can always override the auto-detected source in the UI (e.g. paste a token
even when orgs exist). Tokens resolved from `.env`/`sf` are never returned to the
browser — only the *source label* and the org list (aliases/usernames/instance URLs)
are.

## Daemon API

- `GET /` and static assets → serves the generator (the built HTML/JS/CSS).
- `GET /status` → `{ ok: true, cwd, port, running: boolean }`. Used for the
  connection indicator and to reflect "a run is in progress".
- `GET /auth` → describes the local auth environment for the UI:
  ```json
  {
    "envCredential": "bearer" | "clientCredentials" | null,
    "sfAvailable": true,
    "orgs": [
      { "alias": "my-org", "username": "me@example.com",
        "instanceUrl": "https://...", "isDefault": true }
    ],
    "recommendedSource": "env" | "sf" | "paste"
  }
  ```
  Reads `.env` presence and runs `sf org list --json`. No tokens included.
- `GET /config` → `{ hasConf, yaml, script }`. Returns any `conf.yaml` and
  `scripts.js` already in the daemon's folder so the generator can preload the
  on-disk configuration on open (disk wins over the browser draft). Nulls when absent.
- `POST /run` → starts a run. Rejects with `409` if a run is already active.
  Request body (JSON):
  ```json
  {
    "yaml": "<conf.yaml text>",
    "script": "<scripts.js text, optional>",
    "hasTransform": true,
    "auth": {
      "source": "env" | "sf" | "paste",
      "org": "my-org",                              // when source == "sf"
      "instanceUrl": "https://your-domain...",      // when source == "paste"
      "accessToken": "<bearer token>"               // when source == "paste"
    },
    "fromTask": "Insert Contacts",   // optional
    "toTask": 5                       // optional
  }
  ```
  Auth handling per `source`:
  - `env`: spawn the CLI with no injected credentials; the CLI's own `dotenv` +
    env precedence resolves `.env`.
  - `sf`: daemon resolves a fresh token for `org` via `sf`; on failure returns an
    error the UI shows as "org expired / not logged in — paste a token".
  - `paste`: inject `SF_ACCESS_TOKEN`/`SF_INSTANCE_URL` from the request.
  Response: `200` with a chunked `text/plain` body. Each CLI stdout/stderr line is
  forwarded as it arrives. A final machine-readable trailer line (e.g.
  `\n__SFDATA_RESULT__ {json}`) carries `{ exitCode, status, outputs: [{name, rows}] }`
  so the browser can render the summary without re-parsing every log line.

### Output-file list parsing
The CLI already prints, in phases 5 and 6:
```
        + <sheet>.csv: <n> row(s)
```
The daemon parses these lines to build `outputs`. No file contents are read.
(Alternative/robustness: also `readdir` the `output/` folder and `stat` sizes;
row counts still come from stdout.)

## Generator UI changes (`web/src/`)

- **Run panel / toolbar action**: a "Run" button plus a daemon connection status dot.
- **Auth selector**: on open, the generator calls `GET /auth` and shows the resolved
  source. When `sf` orgs exist, render an **org picker** (alias/username, default
  marked). Always offer a "paste a token" option to override. When the picked org's
  token is expired or `.env`/`sf` are unavailable, prompt for a pasted token.
- **Credentials fields** (paste mode): instance URL + bearer token inputs, persisted
  in `sessionStorage` (session-scoped), kept out of the `localStorage` config draft.
- **Range pickers**: optional From / To action selectors sourced from the existing
  ordered action list.
- **Confirm dialog**: shows target host, action count, and range; confirm to proceed.
- **Execution view**: live log panel (append lines from the stream), a running/idle
  state, and on completion a summary banner (success / accepted row errors / failed)
  plus the output file list with row counts.
- **Disabled states**: Run disabled when the daemon is unreachable or a run is active.

Reuse the existing modal (`web/src/modal.js`) and state (`web/src/state.js`) patterns;
add a small execution client module (`web/src/execute.js`) that owns the fetch stream
reader and result parsing.

## Files

New:
- `src/daemon/Server.ts` — HTTP server: static serving, `/status`, `/auth`, `/run`,
  spawn + stream + single-run guard + file writing. Reads `--port`/`PORT` (default
  `3111`). Exposed as a `startUiServer(options)` function called from `src/Index.ts`.
- `src/daemon/SfOrgs.ts` — helpers around `sf org list` and
  `sf org auth show-access-token` (list orgs, resolve fresh token for a picked org,
  classify "expired / not logged in").
- `web/src/execute.js` — browser execution client (stream reader, result parsing).
- `tests/daemon/*.test.ts` — vitest coverage.

Changed:
- `src/Index.ts` — detect `--ui`; when set, call `startUiServer` (honoring `--port`)
  and skip the one-shot pipeline. Make `--confFile` **not required** when `--ui` is
  present. Add `--ui` and `--port` options.
- `web/src/components/sf-generator-app.js` — Run panel, status, auth selector + org
  picker, range pickers, confirm, execution view wiring.
- `web/styles/main.css` — execution panel + status styles.
- `web/build.mjs` — no change if the daemon serves the same built HTML; confirm the
  built page can also detect "no daemon" and disable Run when opened via `file://`.
- `package.json` — optional convenience script (e.g. `"ui": "ts-node src/Index.ts
  --ui"`); the primary entry point is `sfdata --ui`.
- `README.md` — document the daemon workflow.

## Task breakdown

1. **`--ui` wiring + daemon skeleton**: add `--ui`/`--port` to `src/Index.ts` (relax
   the `--confFile` requirement under `--ui`); `src/daemon/Server.ts` with `/status`,
   static serving of the built generator, `--port`/`PORT` (default `3111`),
   single-run guard.
2. **Auth resolution** (`src/daemon/SfOrgs.ts` + `/auth`): detect `.env` credential,
   list `sf` orgs, classify availability; expose `recommendedSource`. Per-run token
   resolution for a picked org with expiry/not-logged-in classification.
3. **Run endpoint**: write `conf.yaml` (+ `scripts.js` when a transform exists),
   resolve auth per `source`, spawn the CLI with correct flags/env, stream
   stdout/stderr as chunked response.
4. **Result trailer**: parse `+ file.csv: N row(s)` lines; emit `__SFDATA_RESULT__`
   trailer with exit status + outputs.
5. **Generator execution client** (`web/src/execute.js`): call `/auth`, POST `/run`,
   read the stream, dispatch log lines + final result.
6. **Generator UI**: Run button + status dot, auth selector + org picker, paste-token
   fields (sessionStorage), range pickers, confirm dialog, live log + summary +
   output list.
7. **Docs**: README section covering `sfdata --ui [--port]`, the three auth paths,
   and the org picker.
8. **Tests**: `--ui` starts the server and does not require `--confFile`; daemon
   writes files correctly, spawns with correct flags/env per auth source, streams,
   parses outputs, enforces one-run-at-a-time; transform vs non-transform script
   handling; `/auth` reporting and sf-token/expiry classification (with `sf` mocked);
   port from flag/env/default.

## Open questions / risks

- **Default port** `3111` avoids `dev:web`'s `3001`; still overridable via
  `--port`/`PORT`.
- **`sf` availability**: the daemon must degrade gracefully when `sf` is not
  installed or returns no orgs — `/auth` reports `sfAvailable: false` and the UI goes
  straight to paste-token. Bearer/`.env` paths need no `sf` at all.
- **`.env` credential shape**: `.env` may hold bearer *or* client-credentials; the
  daemon reports which, and defers actual consumption to the CLI's existing env
  precedence rather than re-implementing it.
- **Large output folders**: listing only (no content) keeps responses small; a very
  large `output/` still needs a quick `readdir`, which is cheap.
- **Long runs / stream keep-alive**: the CLI emits per-phase and per-sheet lines, so
  the chunked connection stays active during multi-minute runs.
