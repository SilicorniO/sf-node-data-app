import { DataSheet } from '../model/DataSheet';

export type SheetLoader = () => Promise<DataSheet>;
export type SheetSyncLoader = () => DataSheet;

export class SheetRegistry {
  private readonly sheets = new Map<string, DataSheet>();
  private readonly canonicalNames = new Map<string, string>();
  private readonly loaders = new Map<string, SheetLoader>();
  private readonly syncLoaders = new Map<string, SheetSyncLoader>();

  constructor(initialSheets: { [sheetName: string]: DataSheet } = {}) {
    for (const [name, sheet] of Object.entries(initialSheets)) {
      this.addInput(name, sheet);
    }
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
