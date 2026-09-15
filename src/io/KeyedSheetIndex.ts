import type BetterSqlite3 from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { forEachCsvRow } from './CsvStream';
import { openDatabase } from './NativeModuleLoader';
import { SheetIndex } from './CsvIO';

/** SQLite storage type a table column may be declared as. */
export type SqliteColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'NUMERIC';

/** A resolved column of a created table: its real name and storage type. */
export interface ResolvedColumn {
  name: string;
  type: SqliteColumnType;
}

/** Quotes an identifier so spaces, punctuation and reserved words are safe in SQL. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Converts any better-sqlite3 cell value to the string form the pipeline stores. */
function toCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return String(value);
}

/**
 * A per-run SQLite work database. Sheets become tables only when an explicit `table`
 * action asks for one; nothing is indexed implicitly. Tables use the sheet name as
 * the table name and the sheet's real field names (optionally renamed/typed) as
 * columns, so user SQL and merge/lookup can reference real names. The DB lives in a
 * project cache directory (spilled to disk by SQLite), so tables and joins larger
 * than RAM complete without OOM.
 */
export class SqliteWorkspace {
  private readonly db: BetterSqlite3.Database;
  private readonly dbPath: string;
  private readonly dir: string;
  // A second, read-only connection used only for streaming row iteration. A merge
  // streams one side's rows while probing the other by key on the main connection;
  // better-sqlite3 forbids a second query on a connection whose iterator is still
  // open, so the streaming cursor lives on its own connection. WAL mode lets this
  // reader see the committed tables concurrently.
  private reader: BetterSqlite3.Database | undefined;

  private constructor(db: BetterSqlite3.Database, dbPath: string, dir: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.dir = dir;
  }

  /**
   * Creates a workspace with its DB file under the given (validated-writable) directory.
   * By default the DB file persists between runs so the user can open it in a SQLite
   * client; a persisted run reuses any existing `work.sqlite` (per-table DROP/CREATE keeps
   * re-created tables fresh). Pass `{ reuseExisting: false }` to start from a clean file.
   */
  static create(cacheDir: string, options: { reuseExisting?: boolean } = {}): SqliteWorkspace {
    const reuseExisting = options.reuseExisting ?? true;
    fs.mkdirSync(cacheDir, { recursive: true });
    // Validate writability early with a clear error rather than failing mid-run.
    try {
      fs.accessSync(cacheDir, fs.constants.W_OK);
    } catch {
      throw new Error(`SQLite cache directory is not writable: "${cacheDir}".`);
    }
    const dbPath = path.join(cacheDir, 'work.sqlite');
    if (!reuseExisting) {
      // A stale file from a previous run would carry old tables; start fresh.
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
    const db = openDatabase(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma(`temp_store = FILE`);
    return new SqliteWorkspace(db, dbPath, cacheDir);
  }

  /**
   * Imports a CSV file into a named SQLite table and returns a synchronous SheetIndex
   * over it. Column names/types come from `columns` (which must match the CSV header
   * order). Rows are streamed in (bounded memory) preserving file order via rowid.
   */
  async createTableFromCsv(tableName: string, filePath: string, columns: ResolvedColumn[]): Promise<SheetIndex> {
    const physical = this.defineTable(tableName, columns);
    // A column-less sheet (empty/headerless file) has nothing to insert; the fallback
    // schema-less table just returns nothing on lookup/stream.
    if (columns.length === 0) {
      return new SqliteSheetIndex(this.db, () => this.readerConnection(), physical, []);
    }
    const insert = this.insertStatement(physical, columns);
    const pending: string[][] = [];
    const FLUSH_AT = 5000;
    const flush = this.db.transaction((rows: string[][]) => {
      for (const row of rows) insert.run(row);
    });

    await forEachCsvRow(
      filePath,
      () => { /* schema is fixed by `columns`; header row is skipped by forEachCsvRow */ },
      values => {
        const row = columns.map((_column, index) => values[index] ?? '');
        pending.push(row);
        if (pending.length >= FLUSH_AT) {
          flush(pending.splice(0, pending.length));
        }
      }
    );
    if (pending.length > 0) flush(pending);

    return new SqliteSheetIndex(this.db, () => this.readerConnection(), physical, columns.map(c => c.name));
  }

  /**
   * Imports an in-memory DataSheet-like table into a named SQLite table and returns a
   * SheetIndex over it. Used for sheets produced by earlier actions (no backing file).
   */
  createTableFromRows(tableName: string, rows: string[][], columns: ResolvedColumn[]): SheetIndex {
    const physical = this.defineTable(tableName, columns);
    if (columns.length === 0) {
      return new SqliteSheetIndex(this.db, () => this.readerConnection(), physical, []);
    }
    const insert = this.insertStatement(physical, columns);
    const insertAll = this.db.transaction((allRows: string[][]) => {
      for (const values of allRows) {
        insert.run(columns.map((_column, index) => values[index] ?? ''));
      }
    });
    insertAll(rows);
    return new SqliteSheetIndex(this.db, () => this.readerConnection(), physical, columns.map(c => c.name));
  }

  /**
   * Runs a read-only SQL query and returns its result as string columns/rows. NULLs
   * become empty strings so the result fits the pipeline's string[][] model.
   */
  query(sql: string): { fieldNames: string[]; data: string[][] } {
    const statement = this.db.prepare(sql);
    statement.raw(true);
    const columns = statement.columns().map(column => column.name);
    const rows = statement.all() as unknown[][];
    return {
      fieldNames: columns,
      data: rows.map(row => row.map(toCell)),
    };
  }

  /** Absolute path to the SQLite database file (for reporting / user connection). */
  get databasePath(): string {
    return this.dbPath;
  }

  /**
   * Closes the database connection(s). By default the DB file is left in place so the
   * user can open it afterwards; pass `{ keepFiles: false }` to also remove the cache
   * directory (used when the run cleans its output).
   */
  dispose(options: { keepFiles?: boolean } = {}): void {
    const keepFiles = options.keepFiles ?? true;
    try {
      if (this.reader) this.reader.close();
      // Fold the WAL back into the main file so the kept work.sqlite is self-contained
      // and external clients (e.g. DBeaver) see every table without the -wal/-shm files.
      if (keepFiles) {
        try {
          this.db.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          // A checkpoint failure must not prevent closing; close still checkpoints.
        }
      }
      this.db.close();
    } finally {
      if (!keepFiles) {
        fs.rmSync(this.dir, { recursive: true, force: true });
      }
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

  // Creates the table using the sheet name as the SQL table name (quoted), so user SQL
  // and merge/lookup reference sheets by their real name. Any prior table of that name
  // is dropped first (re-creating a sheet's table replaces it). Returns the quoted name.
  private defineTable(tableName: string, columns: ResolvedColumn[]): string {
    const physical = quoteIdentifier(tableName);
    this.db.exec(`DROP TABLE IF EXISTS ${physical}`);
    const columnDefs = columns.map(column => `${quoteIdentifier(column.name)} ${column.type}`).join(', ');
    // A schema-less empty table (no columns) keeps lookups returning nothing.
    this.db.exec(`CREATE TABLE ${physical} (${columnDefs || '"c0" TEXT'})`);
    return physical;
  }

  private insertStatement(physical: string, columns: ResolvedColumn[]): BetterSqlite3.Statement {
    const names = columns.map(column => quoteIdentifier(column.name)).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    return this.db.prepare(`INSERT INTO ${physical} (${names}) VALUES (${placeholders})`);
  }
}

/** SheetIndex backed by a SQLite table; indexes columns lazily on first probe. */
class SqliteSheetIndex implements SheetIndex {
  readonly fieldNames: string[];
  private readonly db: BetterSqlite3.Database;
  private readonly readerConnection: () => BetterSqlite3.Database;
  // Quoted table name, safe to interpolate into FROM/ON clauses.
  private readonly table: string;
  // Sanitized base used to build a valid (unquoted) supporting-index identifier.
  private readonly indexBase: string;
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
    this.indexBase = table.replace(/[^A-Za-z0-9_]/g, '_');
    this.fieldNames = fieldNames;
  }

  lookupAll(field: string, value: string): string[][] {
    const columnIndex = this.fieldNames.indexOf(field);
    if (columnIndex < 0) {
      throw new Error(`Field "${field}" was not found in the indexed sheet.`);
    }
    const statement = this.statementFor(columnIndex);
    statement.raw(true);
    const rows = statement.all(value) as unknown[][];
    return rows.map(row => row.map(toCell));
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
    statement.raw(true);
    for (const row of statement.iterate() as IterableIterator<unknown[]>) {
      yield row.map(toCell);
    }
  }

  dispose(options: { keepTable?: boolean } = {}): void {
    // Dropping the table frees space in a transient DB, but must be skipped when the
    // caller keeps the cache DB — otherwise the persisted work.sqlite ends up empty.
    if (!options.keepTable) {
      this.db.exec(`DROP TABLE IF EXISTS ${this.table}`);
    }
  }

  // Returns a cached prepared SELECT for the given column, creating the supporting
  // index on first use so probes are O(log n) rather than a full scan.
  private statementFor(columnIndex: number): BetterSqlite3.Statement {
    const column = quoteIdentifier(this.fieldNames[columnIndex]);
    if (!this.indexedColumns.has(columnIndex)) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${this.indexBase}_${columnIndex} ON ${this.table} (${column})`);
      this.indexedColumns.add(columnIndex);
    }
    let statement = this.selectStatements.get(columnIndex);
    if (!statement) {
      // rowid ordering preserves the original row order.
      statement = this.db.prepare(`SELECT * FROM ${this.table} WHERE ${column} = ? ORDER BY rowid`);
      this.selectStatements.set(columnIndex, statement);
    }
    return statement;
  }
}
