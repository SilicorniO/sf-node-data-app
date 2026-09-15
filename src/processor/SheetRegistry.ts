import * as os from 'os';
import * as path from 'path';
import { DataSheet } from '../model/DataSheet';
import { InMemorySheetIndex, SheetIndex } from '../io/CsvIO';
import { ResolvedColumn, SqliteWorkspace } from '../io/KeyedSheetIndex';
import { readCsvHeaders } from '../io/CsvStream';

export type SheetLoader = () => Promise<DataSheet>;
export type SheetSyncLoader = () => DataSheet;

export class SheetRegistry {
  private readonly sheets = new Map<string, DataSheet>();
  private readonly canonicalNames = new Map<string, string>();
  private readonly loaders = new Map<string, SheetLoader>();
  private readonly syncLoaders = new Map<string, SheetSyncLoader>();
  // CSV source path per file-backed sheet, so a `table` action can stream it into
  // SQLite from disk instead of materializing the whole sheet in memory.
  private readonly csvPaths = new Map<string, string>();
  // Keyed indexes, built only for sheets a `table` action has turned into a table.
  private readonly indexes = new Map<string, SheetIndex>();
  // Sheets that have a created SQLite table. Merge/lookup/sql use it when present.
  private readonly tabled = new Set<string>();
  private workspace: SqliteWorkspace | undefined;
  private readonly cacheDir: string;
  // When true (default) the SQLite cache DB persists after the run so the user can open
  // it; a run that cleans its output starts fresh and removes it on dispose.
  private readonly keepCache: boolean;

  constructor(
    initialSheets: { [sheetName: string]: DataSheet } = {},
    cacheDir?: string,
    keepCache = true
  ) {
    this.cacheDir = cacheDir ?? path.join(os.tmpdir(), 'sfdata-sqlite-cache');
    this.keepCache = keepCache;
    for (const [name, sheet] of Object.entries(initialSheets)) {
      this.addInput(name, sheet);
    }
  }

  /** Records the CSV file a sheet is backed by so a `table` action can stream it. */
  registerCsvSource(name: string, csvPath: string): void {
    this.csvPaths.set(this.normalize(name), csvPath);
  }

  /**
   * Whether createTable() can stream this sheet straight from its backing CSV without
   * loading it into memory (it has a CSV path and is not already resident).
   */
  canStreamCsv(name: string): boolean {
    const key = this.normalize(name);
    return this.csvPaths.has(key) && !this.sheets.has(key);
  }

  addInput(name: string, sheet: DataSheet): void {
    const key = this.normalize(name);
    if (this.canonicalNames.has(key)) {
      throw new Error(`Duplicate input sheet names differ only by case: "${this.canonicalNames.get(key)}" and "${name}".`);
    }
    this.canonicalNames.set(key, name);
    this.sheets.set(key, { ...sheet, name });
  }

  /**
   * Registers a lazy loader for an input sheet. The sheet is read from disk only
   * when first required, and can be released afterwards to free memory.
   */
  registerLoader(name: string, loader: SheetLoader, syncLoader?: SheetSyncLoader): void {
    const key = this.normalize(name);
    if (this.canonicalNames.has(key)) {
      throw new Error(`Duplicate input sheet names differ only by case: "${this.canonicalNames.get(key)}" and "${name}".`);
    }
    this.canonicalNames.set(key, name);
    this.loaders.set(key, loader);
    if (syncLoader) {
      this.syncLoaders.set(key, syncLoader);
    }
  }

  /** Whether a sheet is present in memory or can be loaded on demand. */
  isKnown(name: string): boolean {
    const key = this.normalize(name);
    return this.sheets.has(key) || this.loaders.has(key);
  }

  /** Whether a sheet can be reloaded from disk after being released. */
  isReloadable(name: string): boolean {
    return this.loaders.has(this.normalize(name));
  }

  /** Lists every sheet name currently held in memory. */
  loadedNames(): string[] {
    return Array.from(this.sheets.keys()).map(key => this.canonicalNames.get(key) ?? key);
  }

  /**
   * Ensures a sheet is available in memory, running its registered loader on
   * first access. Returns the loaded DataSheet.
   */
  async load(name: string): Promise<DataSheet> {
    const key = this.normalize(name);
    const existing = this.sheets.get(key);
    if (existing) {
      return existing;
    }
    const loader = this.loaders.get(key);
    if (!loader) {
      throw new Error(`Input DataSheet "${name}" was not found.`);
    }
    const canonicalName = this.canonicalNames.get(key) ?? name;
    const sheet = { ...(await loader()), name: canonicalName };
    this.sheets.set(key, sheet);
    return sheet;
  }

  /** Drops a sheet from memory. A registered loader (if any) is kept so it can be reloaded. */
  release(name: string): void {
    this.sheets.delete(this.normalize(name));
  }

  has(name: string): boolean {
    return this.sheets.has(this.normalize(name));
  }

  get(name: string): DataSheet | undefined {
    return this.sheets.get(this.normalize(name));
  }

  require(name: string): DataSheet {
    const key = this.normalize(name);
    const sheet = this.sheets.get(key);
    if (sheet) {
      return sheet;
    }
    // Reload a released file-backed sheet on demand (used by transform lookups).
    const syncLoader = this.syncLoaders.get(key);
    if (syncLoader) {
      const canonicalName = this.canonicalNames.get(key) ?? name;
      const reloaded = { ...syncLoader(), name: canonicalName };
      this.sheets.set(key, reloaded);
      return reloaded;
    }
    if (this.loaders.has(key)) {
      throw new Error(`Input DataSheet "${name}" has not been loaded yet.`);
    }
    throw new Error(`Input DataSheet "${name}" was not found.`);
  }

  /**
   * Creates a SQLite table for a sheet, streaming from its backing CSV when the sheet
   * is file-backed (so files larger than RAM never have to be materialized) or from
   * the in-memory DataSheet otherwise. `columns` resolves any renames/types; fields
   * not listed keep their original name and TEXT. Re-creating for a sheet replaces
   * the previous table. The resulting index is what merge/lookup/sql use.
   */
  async createTable(name: string, columns: TableColumnSpec[] = []): Promise<void> {
    const key = this.normalize(name);
    if (!this.workspace) {
      // Persisted runs reuse any existing DB file (per-table DROP/CREATE keeps re-created
      // tables fresh); a cleaning run starts from a clean file.
      this.workspace = SqliteWorkspace.create(this.cacheDir, { reuseExisting: this.keepCache });
    }
    // Replace any existing table for this sheet.
    const previous = this.indexes.get(key);
    if (previous) {
      previous.dispose();
      this.indexes.delete(key);
    }

    const csvPath = this.csvPaths.get(key);
    const fromFile = csvPath !== undefined && !this.sheets.has(key);
    const fieldNames = fromFile ? readCsvHeaders(csvPath!) : this.require(name).fieldNames;
    const resolved = resolveColumns(name, fieldNames, columns);

    const index = fromFile
      ? await this.workspace.createTableFromCsv(key, csvPath!, resolved)
      : this.workspace.createTableFromRows(key, this.require(name).data, resolved);
    this.indexes.set(key, index);
    this.tabled.add(key);
  }

  /** Whether a `table` action has created a SQLite table for this sheet. */
  hasTable(name: string): boolean {
    return this.tabled.has(this.normalize(name));
  }

  /** Runs a read-only SQL query against the created tables. */
  queryTables(sql: string): { fieldNames: string[]; data: string[][] } {
    if (!this.workspace) {
      throw new Error('No SQLite tables have been created; add a "table" action first.');
    }
    return this.workspace.query(sql);
  }

  /**
   * Returns a synchronous keyed index for a sheet. Prefers a created SQLite table's
   * index; otherwise falls back to an in-memory index built from the loaded/produced
   * DataSheet (the default when no `table` action ran for the sheet).
   */
  index(name: string): SheetIndex {
    const key = this.normalize(name);
    const existing = this.indexes.get(key);
    if (existing) {
      return existing;
    }
    const sheet = this.require(name);
    const built = new InMemorySheetIndex(sheet.fieldNames, sheet.data);
    this.indexes.set(key, built);
    return built;
  }

  /** Lists sheet names that currently have a keyed index built (canonical names). */
  indexedNames(): string[] {
    return Array.from(this.indexes.keys()).map(key => this.canonicalNames.get(key) ?? key);
  }

  /**
   * Drops a sheet's cached index. Created SQLite tables are kept: they are an explicit,
   * durable asset that later actions (e.g. sql) may still reference; only transient
   * in-memory indexes are released here.
   */
  releaseIndex(name: string): void {
    const key = this.normalize(name);
    if (this.tabled.has(key)) {
      return;
    }
    const index = this.indexes.get(key);
    if (index) {
      index.dispose();
      this.indexes.delete(key);
    }
  }

  /**
   * Disposes the SQLite workspace and all indexes. Call once the run is done. Returns
   * the path to the persisted SQLite database when the cache is kept (so the caller can
   * tell the user where to connect), or undefined when nothing was created / it was
   * cleaned up.
   */
  disposeIndexes(): string | undefined {
    // Keep the tables in place when the cache DB is persisted, so the user can open
    // work.sqlite and still find them; only drop them for a transient (cleaned) run.
    for (const index of this.indexes.values()) {
      index.dispose({ keepTable: this.keepCache });
    }
    this.indexes.clear();
    this.tabled.clear();
    let databasePath: string | undefined;
    if (this.workspace) {
      if (this.keepCache) {
        databasePath = this.workspace.databasePath;
      }
      this.workspace.dispose({ keepFiles: this.keepCache });
      this.workspace = undefined;
    }
    return databasePath;
  }

  set(name: string, sheet: DataSheet): DataSheet {
    const key = this.normalize(name);
    const canonicalName = this.canonicalNames.get(key) ?? name;
    this.canonicalNames.set(key, canonicalName);
    const stored = { ...sheet, name: canonicalName };
    this.sheets.set(key, stored);
    // A produced/updated sheet invalidates any table built from its previous contents;
    // a later action that needs the table must re-create it with the new data.
    const previous = this.indexes.get(key);
    if (previous && this.tabled.has(key)) {
      previous.dispose();
      this.indexes.delete(key);
      this.tabled.delete(key);
    }
    return stored;
  }

  entries(): Array<[string, DataSheet]> {
    return Array.from(this.sheets.entries()).map(([key, sheet]) => [
      this.canonicalNames.get(key) ?? sheet.name,
      sheet,
    ]);
  }

  toObject(): { [sheetName: string]: DataSheet } {
    return Object.fromEntries(this.entries());
  }

  private normalize(name: string): string {
    return name.toLocaleLowerCase();
  }
}

/** A per-column override supplied by a `table` action. */
export interface TableColumnSpec {
  source: string;
  name?: string;
  type?: ResolvedColumn['type'];
}

/**
 * Resolves a sheet's field names plus optional overrides into the final table columns.
 * Fields not overridden keep their name and default to TEXT. Fails fast (naming the
 * sheet + column) on an override for a missing field, or a rename collision (exact or
 * case-insensitive) or empty resulting name — a bad table would silently break SQL.
 */
function resolveColumns(sheetName: string, fieldNames: string[], specs: TableColumnSpec[]): ResolvedColumn[] {
  const overrides = new Map<string, TableColumnSpec>();
  for (const spec of specs) {
    const sourceKey = spec.source.toLocaleLowerCase();
    if (!fieldNames.some(field => field.toLocaleLowerCase() === sourceKey)) {
      throw new Error(`Table action for sheet "${sheetName}": column "${spec.source}" is not a field of the sheet.`);
    }
    overrides.set(sourceKey, spec);
  }

  const resolved: ResolvedColumn[] = fieldNames.map(field => {
    const override = overrides.get(field.toLocaleLowerCase());
    const name = (override?.name ?? field).trim();
    if (name === '') {
      throw new Error(`Table action for sheet "${sheetName}": column "${field}" resolves to an empty name.`);
    }
    return { name, type: override?.type ?? 'TEXT' };
  });

  const seen = new Map<string, string>();
  for (const column of resolved) {
    const key = column.name.toLocaleLowerCase();
    const existing = seen.get(key);
    if (existing) {
      throw new Error(
        `Table action for sheet "${sheetName}": columns "${existing}" and "${column.name}" collide `
        + `(names must be unique ignoring case).`
      );
    }
    seen.set(key, column.name);
  }
  return resolved;
}
