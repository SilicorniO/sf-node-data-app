import { DataSheet } from '../model/DataSheet';
import { InMemorySheetIndex, SheetIndex } from '../io/CsvIO';
import { SqliteWorkspace } from '../io/KeyedSheetIndex';

export type SheetLoader = () => Promise<DataSheet>;
export type SheetSyncLoader = () => DataSheet;

export class SheetRegistry {
  private readonly sheets = new Map<string, DataSheet>();
  private readonly canonicalNames = new Map<string, string>();
  private readonly loaders = new Map<string, SheetLoader>();
  private readonly syncLoaders = new Map<string, SheetSyncLoader>();
  // CSV source path per file-backed sheet, so it can be indexed out-of-core in
  // SQLite for merge/lookup instead of being fully materialized in memory.
  private readonly csvPaths = new Map<string, string>();
  // Lazily-built keyed indexes (SQLite-backed for CSV sheets, in-memory otherwise).
  private readonly indexes = new Map<string, SheetIndex>();
  private workspace: SqliteWorkspace | undefined;

  constructor(initialSheets: { [sheetName: string]: DataSheet } = {}) {
    for (const [name, sheet] of Object.entries(initialSheets)) {
      this.addInput(name, sheet);
    }
  }

  /** Records the CSV file a sheet is backed by so it can be indexed out-of-core. */
  registerCsvSource(name: string, csvPath: string): void {
    this.csvPaths.set(this.normalize(name), csvPath);
  }

  /**
   * Whether a sheet can be indexed out-of-core (it is backed by a CSV file and has
   * not already been materialized in memory). Callers use this to prefer building a
   * SQLite index over loading the whole sheet for merge/lookup.
   */
  canIndexOutOfCore(name: string): boolean {
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
   * Builds a keyed index for a sheet ahead of a merge/lookup, out-of-core when the
   * sheet is backed by a CSV file (streamed into a temp SQLite table so a file
   * larger than RAM can be probed). Idempotent; safe to call for every candidate.
   */
  async prepareIndex(name: string): Promise<void> {
    const key = this.normalize(name);
    if (this.indexes.has(key)) {
      return;
    }
    const csvPath = this.csvPaths.get(key);
    if (!csvPath) {
      return; // Not file-backed; index() will fall back to an in-memory index.
    }
    if (!this.workspace) {
      this.workspace = SqliteWorkspace.create();
    }
    this.indexes.set(key, await this.workspace.indexCsv(csvPath));
  }

  /**
   * Returns a synchronous keyed index for a sheet. Prefers a pre-built (SQLite,
   * out-of-core) index; otherwise falls back to an in-memory index built from the
   * loaded/produced DataSheet — preserving the pre-existing behavior for sheets
   * that were already required into memory (e.g. dynamic transform lookups).
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

  /** Drops a sheet's cached index (used when the sheet is released). */
  releaseIndex(name: string): void {
    const key = this.normalize(name);
    const index = this.indexes.get(key);
    if (index) {
      index.dispose();
      this.indexes.delete(key);
    }
  }

  /** Disposes the SQLite workspace and all indexes. Call once the run is done. */
  disposeIndexes(): void {
    for (const index of this.indexes.values()) {
      index.dispose();
    }
    this.indexes.clear();
    if (this.workspace) {
      this.workspace.dispose();
      this.workspace = undefined;
    }
  }

  set(name: string, sheet: DataSheet): DataSheet {
    const key = this.normalize(name);
    const canonicalName = this.canonicalNames.get(key) ?? name;
    this.canonicalNames.set(key, canonicalName);
    const stored = { ...sheet, name: canonicalName };
    this.sheets.set(key, stored);
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
