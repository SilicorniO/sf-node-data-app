import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteWorkspace } from '../../src/io/KeyedSheetIndex';

let tempDir: string;
let workspace: SqliteWorkspace;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-idx-'));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  workspace = SqliteWorkspace.create();
});

afterEach(() => {
  workspace.dispose();
});

function writeCsv(name: string, content: string): string {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('KeyedSheetIndex (SqliteWorkspace)', () => {
  it('serves synchronous lookups by any field', async () => {
    const filePath = writeCsv('people.csv', 'Id,Name,City\n1,Alice,NYC\n2,Bob,LA\n3,Carol,NYC\n');
    const index = await workspace.indexCsv(filePath);

    expect(index.fieldNames).toEqual(['Id', 'Name', 'City']);
    expect(index.lookup('Id', '2')).toEqual(['2', 'Bob', 'LA']);
    expect(index.lookup('Name', 'Alice')).toEqual(['1', 'Alice', 'NYC']);
    expect(index.lookup('Id', 'missing')).toBeUndefined();
  });

  it('returns all matches in file order for lookupAll', async () => {
    const filePath = writeCsv('cities.csv', 'Id,City\n1,NYC\n2,LA\n3,NYC\n4,NYC\n');
    const index = await workspace.indexCsv(filePath);

    expect(index.lookupAll('City', 'NYC')).toEqual([
      ['1', 'NYC'],
      ['3', 'NYC'],
      ['4', 'NYC'],
    ]);
    expect(index.lookupAll('City', 'none')).toEqual([]);
  });

  it('throws for an unknown field', async () => {
    const filePath = writeCsv('one.csv', 'A,B\n1,2\n');
    const index = await workspace.indexCsv(filePath);
    expect(() => index.lookup('C', 'x')).toThrow(/Field "C" was not found/);
  });

  it('handles quoted cells with commas and newlines', async () => {
    const filePath = writeCsv('notes.csv', 'Id,Note\n1,"a,b"\n2,"line1\nline2"\n');
    const index = await workspace.indexCsv(filePath);
    expect(index.lookup('Id', '1')).toEqual(['1', 'a,b']);
    expect(index.lookup('Id', '2')).toEqual(['2', 'line1\nline2']);
  });

  it('handles many rows (batched insert path)', async () => {
    const rows = Array.from({ length: 12000 }, (_v, i) => `${i},name${i}`).join('\n');
    const filePath = writeCsv('big.csv', `Id,Name\n${rows}\n`);
    const index = await workspace.indexCsv(filePath);
    expect(index.lookup('Id', '11999')).toEqual(['11999', 'name11999']);
    expect(index.lookup('Id', '0')).toEqual(['0', 'name0']);
  });

  it('handles an empty file', async () => {
    const filePath = writeCsv('empty.csv', '');
    const index = await workspace.indexCsv(filePath);
    expect(index.fieldNames).toEqual([]);
  });
});
