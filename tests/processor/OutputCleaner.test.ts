import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { OutputCleaner } from '../../src/processor/OutputCleaner';

const temporaryFolders: string[] = [];

function temporaryFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-output-cleaner-'));
  temporaryFolders.push(folder);
  return folder;
}

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

describe('OutputCleaner', () => {
  it('deletes default and configured error files while preserving other outputs', () => {
    const folder = temporaryFolder();
    fs.writeFileSync(path.join(folder, 'Insert-errors.csv'), 'error');
    fs.writeFileSync(path.join(folder, 'Custom Failures.csv'), 'error');
    fs.writeFileSync(path.join(folder, 'Accounts.csv'), 'data');

    const result = OutputCleaner.clean(folder, false, true, ['Custom Failures']);

    expect(result).toEqual({ mode: 'errors', deletedFiles: 2 });
    expect(fs.readdirSync(folder)).toEqual(['Accounts.csv']);
  });

  it('removes all files and nested folders during full cleanup', () => {
    const folder = temporaryFolder();
    const nested = path.join(folder, 'old');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(folder, 'Accounts.csv'), 'data');
    fs.writeFileSync(path.join(nested, 'Details.csv'), 'data');

    const result = OutputCleaner.clean(folder, true, true, []);

    expect(result).toEqual({ mode: 'all', deletedFiles: 2 });
    expect(fs.readdirSync(folder)).toEqual([]);
  });

  it('refuses to clean the current working directory', () => {
    expect(() => OutputCleaner.clean('.', true, false, []))
      .toThrow(/Refusing to clean unsafe output folder/);
  });

  it('refuses to clean a folder containing an input file', () => {
    const folder = temporaryFolder();
    const inputFile = path.join(folder, 'input.csv');
    fs.writeFileSync(inputFile, 'Name\nAcme');

    expect(() => OutputCleaner.clean(folder, true, false, [], [inputFile]))
      .toThrow(/contains input or configuration file/);
    expect(fs.existsSync(inputFile)).toBe(true);
  });
});
