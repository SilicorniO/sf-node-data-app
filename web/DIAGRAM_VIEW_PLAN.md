# Data-Flow Diagram View — Design Plan

A new **view-only** "Diagram" tab for the web config generator that renders a
pipeline's YAML config as a data-flow graph: sheets as boxes, actions as
colored curved arrows, with a Salesforce node as the shared source/sink. The
goal is to let a user *see how data is transformed across the timeline and the
dependencies between sheets* — no editing in this view.

---

## 1. Scope & data source

- **Static config only.** The diagram is built entirely from the YAML config
  currently in `state` (the same model the Preview tab emits). There is **no
  execution/runtime data** — no real row counts, no produced files, no
  durations. All "file information" shown is *declared* info (field mappings,
  query text, script path, object name, field count).
- **View mode only.** No node dragging, no editing. Selection opens a read-only
  detail panel.

## 2. Placement

- A **new 5th top-level tab: "Diagram"**, alongside App / Sheets / Actions /
  Preview.
- Register it in `web/src/state.js` (`normalizeState` tab list becomes
  `['app','sheets','actions','preview','diagram']`) and add the tab button +
  panel dispatch in `web/src/components/sf-generator-app.js`.

## 3. Graph model (topology)

**Nodes:**
- **Sheet boxes** — one per sheet that *participates in the dataflow*.
- **One shared Salesforce node** (cloud icon) — the source/sink for all
  Salesforce reads/writes. The **object name** (Account, Task, …) rides on the
  arrow label, not on separate nodes.

**Edges = actions**, one arrow per action, mapped by type:

| Action    | Arrow(s) |
|-----------|----------|
| `get`     | Salesforce → outputSheet box |
| `insert`  | inputSheet box → Salesforce; **if** `outputSheet` set, also Salesforce → id-output box (a second arrow) |
| `update`  | inputSheet box → Salesforce |
| `upsert`  | inputSheet box → Salesforce |
| `delete`  | inputSheet box → Salesforce |
| `transform` | inputSheet box → outputSheet box |
| `merge`   | primarySheet box → outputSheet **and** secondarySheet box → outputSheet (two converging curves) |

Every arrow connects two real nodes — no floating/fading ends, no badges.

### Which sheet boxes appear

A sheet box is rendered **only if it participates in the dataflow**:
- Sheets referenced as an input (`inputSheet`, `primarySheet`, `secondarySheet`)
  or produced as an output (`outputSheet`) by some action.
- **Error sheets** (implicit `${name}-errors`, default) appear **only when
  another action consumes that error sheet as an input.** A produced-but-never-
  read error sheet is omitted.
- **Orphan sheets** (declared in `sheets:` but never referenced by any action)
  are **hidden**.

## 4. Layout & rendering

- **Auto layered DAG layout via `dagre`** (npm dependency — use
  `@dagrejs/dagre`, the maintained fork; CommonJS, bundled by esbuild into the
  single inlined HTML — no CDN/network at runtime).
- **Custom SVG rendering** on top of dagre's computed node positions and edge
  control points. We render nodes and arrows ourselves for full control of the
  aesthetics.
- Because auto-layout means node *position* doesn't strictly encode YAML run
  order, **execution order is shown by a step-number badge (1, 2, 3…) on each
  action arrow** (the action's 1-based index in the config).

## 5. Visual language

- **Arrows colored by action type** (all 7: get, insert, update, upsert,
  delete, transform, merge). Group hues sensibly — e.g. reads one family,
  writes another, local transforms another. **Sheet boxes are neutral and
  identical** (role is not encoded on the box; it lives in the detail panel).
- **Arrow style:** smooth **cubic-bezier curves** (never plain straight),
  colored arrowheads per type, gentle organic curvature that avoids overlaps.
  `merge` and insert-with-output render as **two converging curves** into the
  output box.
- **Labels at a glance:**
  - **Arrow:** type icon + action name + target object (for SF actions) +
    step-number badge.
  - **Box:** sheet name + field/column count.
  - Everything else (SOQL query, full field list, script path, options, the
    name→apiName field mapping) → **detail panel** on click.

## 6. Interaction

- **Pan** (drag), **zoom** (scroll/pinch), **fit-to-screen** button.
- **Click a node or arrow → docked side panel** with full read-only details:
  - Action arrow: type, name, object, full query/script/fields/options,
    externalIdField/idField, wait/continueOnError/errorRows.
  - Sheet box: name, field count, and the name→apiName mapping table.
- **Transform dynamic dependencies** (`lookup(sheet,…)` inside scripts) are
  **ignored** in v1 (only declared inputSheet/outputSheet are drawn). The
  detail panel for a transform may note "may read other sheets at runtime."
- **Empty / invalid state:** friendly placeholder — if no actions, a centered
  hint ("Add actions to see the data-flow diagram"); if the config fails
  validation, a message pointing to the Preview/Actions tab instead of a broken
  canvas.

## 7. Code structure

- **`web/src/diagram-model.js`** — pure module: `config (state) → { nodes, edges }`
  graph builder. Encapsulates all the rules above (SF node, edge mapping,
  which sheets are visible, error-sheet-if-consumed, orphan hiding, step
  numbers). Testable in isolation, no DOM.
- **`web/src/components/sf-diagram-panel.js`** — the custom element: runs
  `diagram-model` → feeds `@dagrejs/dagre` → renders SVG (nodes, bezier edges,
  labels), handles pan/zoom/fit, selection, and the side panel.
- Wire the new tab into `web/src/state.js` and
  `web/src/components/sf-generator-app.js`.
- Add `@dagrejs/dagre` to `package.json`; esbuild inlines it into
  `dist-web/execconf_generator.html`.

## Open items deferred to later (not v1)

- Live execution overlay (row counts, produced files, errors, durations) — the
  app has no runtime today; design keeps this addable later.
- Static parsing of transform `lookup()` calls to draw dynamic-dependency
  arrows.
- Editing from the diagram.
