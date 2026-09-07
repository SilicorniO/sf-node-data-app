import { DataSheet } from '../model/DataSheet';

export class SheetRegistry {
  private readonly sheets = new Map<string, DataSheet>();
  private readonly canonicalNames = new Map<string, string>();

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

  has(name: string): boolean {
    return this.sheets.has(this.normalize(name));
  }

  get(name: string): DataSheet | undefined {
    return this.sheets.get(this.normalize(name));
  }

  require(name: string): DataSheet {
    const sheet = this.get(name);
    if (!sheet) {
      throw new Error(`Input DataSheet "${name}" was not found.`);
    }
    return sheet;
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
