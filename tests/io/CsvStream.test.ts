import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CsvStreamWriter, forEachCsvRow, readCsvHeaders } from '../../src/io/CsvStream';
import { CsvProcessor } from '../../src/processor/CsvProcessor';

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-csvstream-'));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

async function streamAll(filePath: string): Promise<{ headers: string[]; rows: string[][] }> {
  let headers: string[] = [];
  const rows: string[][] = [];
  await forEachCsvRow(filePath, h => (headers = h), r => rows.push(r));
  return { headers, rows };
}

describe('CsvStream', () => {
  it('reads headers and rows matching the whole-file parser', async () => {
    const csv = 'Id,Name\n1,Alice\n2,Bob\n';
    const filePath = writeFile('basic.csv', csv);

    const streamed = await streamAll(filePath);
    const parsed = CsvProcessor.parseCSV(fs.readFileSync(filePath, 'utf8'));

    expect(streamed.headers).toEqual(parsed.headers);
    expect(streamed.rows).toEqual(parsed.data);
    expect(readCsvHeaders(filePath)).toEqual(['Id', 'Name']);
  });

  it('handles quoted fields with commas, quotes and newlines', async () => {
    const csv = 'Id,Note\n1,"a,b"\n2,"he said ""hi"""\n3,"line1\nline2"\n';
    const filePath = writeFile('quoted.csv', csv);

    const streamed = await streamAll(filePath);
    const parsed = CsvProcessor.parseCSV(fs.readFileSync(filePath, 'utf8'));

    expect(streamed.headers).toEqual(parsed.headers);
    expect(streamed.rows).toEqual(parsed.data);
  });

  it('round-trips read -> streaming write -> read with identical rows', async () => {
    const csv = 'Id,Name,Note\n1,Alice,"a,b"\n2,Bob,"c\nd"\n';
    const src = writeFile('src.csv', csv);
    const out = path.join(tempDir, 'out.csv');

    const original = await streamAll(src);
    const writer = new CsvStreamWriter(out);
    writer.writeHeaders(original.headers);
    for (const row of original.rows) writer.writeRow(row);
    await writer.close();

    const roundTripped = await streamAll(out);
    expect(roundTripped.headers).toEqual(original.headers);
    expect(roundTripped.rows).toEqual(original.rows);
  });

  it('reads header from CRLF files', () => {
    const filePath = writeFile('crlf.csv', 'A,B\r\n1,2\r\n');
    expect(readCsvHeaders(filePath)).toEqual(['A', 'B']);
  });

  it('yields empty headers for an empty file', async () => {
    const filePath = writeFile('empty.csv', '');
    const streamed = await streamAll(filePath);
    expect(streamed.headers).toEqual([]);
    expect(streamed.rows).toEqual([]);
  });
});
