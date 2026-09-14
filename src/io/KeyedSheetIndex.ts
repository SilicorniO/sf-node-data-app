import type BetterSqlite3 from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forEachCsvRow } from './CsvStream';
import { openDatabase } from './NativeModuleLoader';
import { SheetIndex } from './CsvIO';

/**
 * A per-run SQLite work database used to index CSV sheets on demand for merge and
 * lookup. Only sheets that are actually probed by key are imported; everything
 * else in the pipeline streams CSV directly and never touches this. The DB lives
 * in a temp directory (spilled to disk by SQLite), so indexed sheets and joins
 * larger than RAM complete without OOM.
 */
export class SqliteWorkspace {
  private readonly db: BetterSqlite3.Database;
  private readonly dbPath: string;
  private readonly dir: string;
  private tableCounter = 0;
  // A second, read-only connection used only for streaming row iteration. A merge
  // streams one side's rows while probing the other by key on the main connection;
  // better-sqlite3 forbids a second query on a connection whose iterator is still
  // open, so the streaming cursor lives on its own connection. WAL mode lets this
  // reader see the committed imported tables concurrently.
  private reader: BetterSqlite3.Database | undefined;

  private constructor(db: BetterSqlite3.Database, dbPath: string, dir: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.dir = dir;
  }

  /** Creates a workspace with its DB file under a validated-writable temp dir. */
  static create(): SqliteWorkspace {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-sqlite-'));
    // Validate writability early with a clear error rather than failing mid-join.
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      throw new Error(`SQLite temp directory is not writable: "${dir}".`);
    }
    const dbPath = path.join(dir, 'work.sqlite');
    const db = openDatabase(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma(`temp_store = FILE`);
    return new SqliteWorkspace(db, dbPath, dir);
  }

  /**
   * Imports a CSV file into an indexed SQLite table and returns a synchronous
   * SheetIndex over it. Rows are streamed in (bounded memory) and stored with
   * their original file order preserved via an autoincrement rowid.
   */
  async indexCsv(filePath: string): Promise<SheetIndex> {
    const table = `sheet_${this.tableCounter++}`;
    const { fieldNames } = await this.importCsv(filePath, table);
    return new SqliteSheetIndex(this.db, () => this.readerConnection(), table, fieldNames);
  }

  /** Closes the database(s) and removes all temp files. */
  dispose(): void {
    try {
      if (this.reader) this.reader.close();
      this.db.close();
    } finally {
      fs.rmSync(this.dir, { recursive: true, force: true });
    }
  }

  // Lazily opens (once) the read-only streaming connection to the same DB file.
  private readerConnection(): BetterSqlite3.Database {
    if (!this.reader) {
      this.reader = openDatabase(this.dbPath);
      this.reader.pragma('query_only = TRUE');
    }
    return this.reader;
  }

  // Streams the CSV into a table with one TEXT column per field (c0, c1, ...) plus
  // an implicit rowid used to preserve file order. Inserts run inside a single
  // transaction for throughput.
  private async importCsv(filePath: string, table: string): Promise<{ fieldNames: string[] }> {
    let fieldNames: string[] = [];
    let insert: BetterSqlite3.Statement | undefined;
    const pending: string[][] = [];
    const FLUSH_AT = 5000;

    const flush = this.db.transaction((rows: string[][]) => {
      for (const row of rows) insert!.run(row);
    });

    await forEachCsvRow(
      filePath,
      headers => {
        fieldNames = headers;
        if (headers.length === 0) {
          // Empty/headerless file: leave the table uncreated so the trailing
          // fallback builds a schema-less empty table and lookups return nothing.
          return;
        }
        const columns = headers.map((_h, index) => `c${index}`);
        const columnDefs = columns.map(column => `${column} TEXT`).join(', ');
        this.db.exec(`CREATE TABLE ${table} (${columnDefs})`);
        const placeholders = columns.map(() => '?').join(', ');
        insert = this.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
      },
      values => {
        // Normalize row width to the header width so the prepared statement always
        // receives the expected number of parameters.
        const row = fieldNames.map((_f, index) => values[index] ?? '');
        pending.push(row);
        if (pending.length >= FLUSH_AT) {
          flush(pending.splice(0, pending.length));
        }
      }
    );

    if (!insert) {
      // Empty file (no header seen): create an empty schema-less table so lookups
      // simply return nothing.
      this.db.exec(`CREATE TABLE ${table} (c0 TEXT)`);
    } else if (pending.length > 0) {
      flush(pending);
    }

    return { fieldNames };
  }
}

/** SheetIndex backed by a SQLite table; indexes columns lazily on first probe. */
class SqliteSheetIndex implements SheetIndex {
  readonly fieldNames: string[];
  private readonly db: BetterSqlite3.Database;
  private readonly readerConnection: () => BetterSqlite3.Database;
  private readonly table: string;
  private readonly indexedColumns = new Set<number>();
  private readonly selectStatements = new Map<number, BetterSqlite3.Statement>();

  constructor(
    db: BetterSqlite3.Database,
    readerConnection: () => BetterSqlite3.Database,
    table: string,
    fieldNames: string[]
  ) {
    this.db = db;
    this.readerConnection = readerConnection;
    this.table = table;
    this.fieldNames = fieldNames;
  }

  lookupAll(field: string, value: string): string[][] {
    const columnIndex = this.fieldNames.indexOf(field);
    if (columnIndex < 0) {
      throw new Error(`Field "${field}" was not found in the indexed sheet.`);
    }
    const statement = this.statementFor(columnIndex);
    const rows = statement.all(value) as Array<Record<string, string>>;
    return rows.map(row => this.fieldNames.map((_f, index) => row[`c${index}`] ?? ''));
  }

  lookup(field: string, value: string): string[] | undefined {
    return this.lookupAll(field, value)[0];
  }

  *allRows(): Iterable<string[]> {
    if (this.fieldNames.length === 0) {
      return;
    }
    // Stream every row in file order without materializing the whole table. Uses a
    // dedicated read-only connection so callers can probe this or another table by
    // key on the main connection while this cursor is still open (a merge streams one
    // side and probes the other per row).
    const statement = this.readerConnection().prepare(`SELECT * FROM ${this.table} ORDER BY rowid`);
    for (const row of statement.iterate() as IterableIterator<Record<string, string>>) {
      yield this.fieldNames.map((_f, index) => row[`c${index}`] ?? '');
    }
  }

  dispose(): void {
    this.db.exec(`DROP TABLE IF EXISTS ${this.table}`);
  }

  // Returns a cached prepared SELECT for the given column, creating the supporting
  // index on first use so probes are O(log n) rather than a full scan.
  private statementFor(columnIndex: number): BetterSqlite3.Statement {
    if (!this.indexedColumns.has(columnIndex)) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${this.table}_c${columnIndex} ON ${this.table} (c${columnIndex})`);
      this.indexedColumns.add(columnIndex);
    }
    let statement = this.selectStatements.get(columnIndex);
    if (!statement) {
      // rowid ordering preserves the original CSV row order.
      statement = this.db.prepare(`SELECT * FROM ${this.table} WHERE c${columnIndex} = ? ORDER BY rowid`);
      this.selectStatements.set(columnIndex, statement);
    }
    return statement;
  }
}
