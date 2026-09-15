import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResolvedColumn, SqliteWorkspace } from '../../src/io/KeyedSheetIndex';
import { readCsvHeaders } from '../../src/io/CsvStream';

let tempDir: string;
let cacheDir: string;
let workspace: SqliteWorkspace;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-idx-'));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-idx-cache-'));
  workspace = SqliteWorkspace.create(cacheDir);
});

afterEach(() => {
  // Dispose without keeping files so each test's temp cache dir is removed.
  workspace.dispose({ keepFiles: false });
});

function writeCsv(name: string, content: string): string {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** Builds default (all-TEXT, real-name) columns from a CSV's header row. */
function textColumns(filePath: string): ResolvedColumn[] {
  return readCsvHeaders(filePath).map(name => ({ name, type: 'TEXT' as const }));
}

async function tableFromCsv(filePath: string, columns?: ResolvedColumn[]) {
  return workspace.createTableFromCsv('t', filePath, columns ?? textColumns(filePath));
}

describe('KeyedSheetIndex (SqliteWorkspace)', () => {
  it('serves synchronous lookups by any field, using real column names', async () => {
    const filePath = writeCsv('people.csv', 'Id,Name,City\n1,Alice,NYC\n2,Bob,LA\n3,Carol,NYC\n');
    const index = await tableFromCsv(filePath);

    expect(index.fieldNames).toEqual(['Id', 'Name', 'City']);
    expect(index.lookup('Id', '2')).toEqual(['2', 'Bob', 'LA']);
    expect(index.lookup('Name', 'Alice')).toEqual(['1', 'Alice', 'NYC']);
    expect(index.lookup('Id', 'missing')).toBeUndefined();
  });

  it('returns all matches in file order for lookupAll', async () => {
    const filePath = writeCsv('cities.csv', 'Id,City\n1,NYC\n2,LA\n3,NYC\n4,NYC\n');
    const index = await tableFromCsv(filePath);

    expect(index.lookupAll('City', 'NYC')).toEqual([
      ['1', 'NYC'],
      ['3', 'NYC'],
      ['4', 'NYC'],
    ]);
    expect(index.lookupAll('City', 'none')).toEqual([]);
  });

  it('throws for an unknown field', async () => {
    const filePath = writeCsv('one.csv', 'A,B\n1,2\n');
    const index = await tableFromCsv(filePath);
    expect(() => index.lookup('C', 'x')).toThrow(/Field "C" was not found/);
  });

  it('handles quoted cells with commas and newlines', async () => {
    const filePath = writeCsv('notes.csv', 'Id,Note\n1,"a,b"\n2,"line1\nline2"\n');
    const index = await tableFromCsv(filePath);
    expect(index.lookup('Id', '1')).toEqual(['1', 'a,b']);
    expect(index.lookup('Id', '2')).toEqual(['2', 'line1\nline2']);
  });

  it('handles many rows (batched insert path)', async () => {
    const rows = Array.from({ length: 12000 }, (_v, i) => `${i},name${i}`).join('\n');
    const filePath = writeCsv('big.csv', `Id,Name\n${rows}\n`);
    const index = await tableFromCsv(filePath);
    expect(index.lookup('Id', '11999')).toEqual(['11999', 'name11999']);
    expect(index.lookup('Id', '0')).toEqual(['0', 'name0']);
  });

  it('handles an empty file', async () => {
    const filePath = writeCsv('empty.csv', '');
    const index = await workspace.createTableFromCsv('t', filePath, []);
    expect(index.fieldNames).toEqual([]);
    expect([...index.allRows()]).toEqual([]);
  });

  it('quotes identifiers with spaces and reserved words', async () => {
    const filePath = writeCsv('quoted.csv', 'First Name,order\nAlice,1\nBob,2\n');
    const index = await tableFromCsv(filePath, [
      { name: 'First Name', type: 'TEXT' },
      { name: 'order', type: 'TEXT' },
    ]);
    expect(index.fieldNames).toEqual(['First Name', 'order']);
    expect(index.lookup('First Name', 'Bob')).toEqual(['Bob', '2']);
  });

  it('honors numeric column types in SQL queries', async () => {
    const filePath = writeCsv('salaries.csv', 'Name,Salary\nAlice,1500\nBob,900\nCarol,12000\n');
    await workspace.createTableFromCsv('t', filePath, [
      { name: 'Name', type: 'TEXT' },
      { name: 'Salary', type: 'INTEGER' },
    ]);
    // A numeric comparison and ORDER BY only behave correctly when Salary is INTEGER.
    const result = workspace.query('SELECT "Name" FROM t WHERE "Salary" > 1000 ORDER BY "Salary" DESC');
    expect(result.fieldNames).toEqual(['Name']);
    expect(result.data).toEqual([['Carol'], ['Alice']]);
  });

  it('creates a table from in-memory rows and stringifies NULLs in query output', () => {
    const index = workspace.createTableFromRows('t', [['Alice', ''], ['Bob', '3']], [
      { name: 'Name', type: 'TEXT' },
      { name: 'Age', type: 'INTEGER' },
    ]);
    expect(index.fieldNames).toEqual(['Name', 'Age']);
    const result = workspace.query('SELECT "Name", NULLIF("Age", \'\') AS "Age" FROM t ORDER BY "Name"');
    expect(result.data).toEqual([['Alice', ''], ['Bob', '3']]);
  });
});
