/**
 * Interface for a synchronous, keyed index over a CSV sheet. Used only by the
 * operations that need whole-file random access (transform `lookup`/`lookupAll`
 * and `merge`). The concrete implementation (KeyedSheetIndex) is backed by an
 * on-disk SQLite table so lookup targets and merge sides larger than RAM can be
 * probed without materializing them in memory. The interface keeps the pipeline
 * decoupled from SQLite and lets unit tests substitute an in-memory fake.
 */
export interface SheetIndex {
  /** Header/field names of the indexed sheet, in file order. */
  readonly fieldNames: string[];

  /** All rows whose `field` cell equals `value`, as raw string arrays (file order). */
  lookupAll(field: string, value: string): string[][];

  /** First row whose `field` cell equals `value`, or undefined. */
  lookup(field: string, value: string): string[] | undefined;

  /** Every row of the sheet in file order (used to stream the primary side of a merge). */
  allRows(): Iterable<string[]>;

  /** Releases any resources (e.g. drops the backing SQLite table). */
  dispose(): void;
}

/**
 * A SheetIndex over an already-in-memory DataSheet-like table. Used for produced
 * or small loaded sheets that have no backing CSV file, so merge/lookup can treat
 * every sheet uniformly through the SheetIndex interface without SQLite.
 */
export class InMemorySheetIndex implements SheetIndex {
  readonly fieldNames: string[];
  private readonly rows: string[][];
  private readonly indexes = new Map<number, Map<string, string[][]>>();

  constructor(fieldNames: string[], rows: string[][]) {
    this.fieldNames = fieldNames;
    this.rows = rows;
  }

  lookupAll(field: string, value: string): string[][] {
    const columnIndex = this.fieldNames.indexOf(field);
    if (columnIndex < 0) {
      throw new Error(`Field "${field}" was not found in the indexed sheet.`);
    }
    return this.indexFor(columnIndex).get(value) ?? [];
  }

  lookup(field: string, value: string): string[] | undefined {
    return this.lookupAll(field, value)[0];
  }

  allRows(): Iterable<string[]> {
    return this.rows;
  }

  dispose(): void {
    this.indexes.clear();
  }

  // Builds (once) and caches a value -> rows map for the given column.
  private indexFor(columnIndex: number): Map<string, string[][]> {
    let map = this.indexes.get(columnIndex);
    if (!map) {
      map = new Map();
      for (const row of this.rows) {
        const key = row[columnIndex] ?? '';
        const bucket = map.get(key);
        if (bucket) {
          bucket.push(row);
        } else {
          map.set(key, [row]);
        }
      }
      this.indexes.set(columnIndex, map);
    }
    return map;
  }
}
