import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { MillerAction } from '../../src/model/MillerAction';
import { MillerRunner, substitutePlaceholders, tokenizeCommand } from '../../src/processor/MillerRunner';
import { SheetRegistry } from '../../src/processor/SheetRegistry';

function millerAvailable(): boolean {
  try {
    execFileSync('mlr', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasMiller = millerAvailable();

describe('tokenizeCommand', () => {
  it('splits on whitespace', () => {
    expect(tokenizeCommand('sort -nr Salary')).toEqual(['sort', '-nr', 'Salary']);
  });

  it('keeps single-quoted expressions as one token and strips the quotes', () => {
    expect(tokenizeCommand("filter '$age > 30'")).toEqual(['filter', '$age > 30']);
  });

  it('keeps double-quoted content and preserves inner single quotes', () => {
    expect(tokenizeCommand(`filter '$Dept == "Eng"'`)).toEqual(['filter', '$Dept == "Eng"']);
  });

  it('collapses runs of whitespace and trims edges', () => {
    expect(tokenizeCommand('  cat   then   tac  ')).toEqual(['cat', 'then', 'tac']);
  });

  it('throws on an unterminated quote', () => {
    expect(() => tokenizeCommand("filter '$x > 3")).toThrow(/nterminated/);
  });
});

describe('substitutePlaceholders', () => {
  const paths = () => new Map<string, string>([
    ['accounts', '/tmp/input-0.csv'],
    ['contacts', '/tmp/input-1.csv'],
  ]);

  it('replaces a placeholder with the input path and records the reference', () => {
    const referenced = new Set<string>();
    expect(substitutePlaceholders('{{accounts}}', paths(), referenced)).toBe('/tmp/input-0.csv');
    expect(referenced.has('accounts')).toBe(true);
  });

  it('matches sheet names case-insensitively and tolerates inner whitespace', () => {
    const referenced = new Set<string>();
    expect(substitutePlaceholders('{{  Accounts  }}', paths(), referenced)).toBe('/tmp/input-0.csv');
    expect(referenced.has('accounts')).toBe(true);
  });

  it('leaves a token without a placeholder untouched', () => {
    const referenced = new Set<string>();
    expect(substitutePlaceholders('-j', paths(), referenced)).toBe('-j');
    expect(referenced.size).toBe(0);
  });

  it('throws when the placeholder names an unknown sheet', () => {
    expect(() => substitutePlaceholders('{{missing}}', paths(), new Set())).toThrow(/unknown input sheet/);
  });
});

describe.runIf(hasMiller)('MillerRunner (requires mlr)', () => {
  const registry = () => {
    const sheets = new SheetRegistry();
    sheets.set('employees', {
      name: 'employees',
      fieldNames: ['Name', 'Salary'],
      data: [
        ['Bob', '30000'],
        ['Ann', '90000'],
        ['Cy', '60000'],
      ],
    });
    return sheets;
  };

  it('runs a Miller verb and returns the transformed sheet', async () => {
    const sheets = registry();
    const action = new MillerAction('Sort', ['employees'], 'sorted', 'sort -nr Salary');
    const result = await new MillerRunner().run(action, sheets);
    expect(result.name).toBe('sorted');
    expect(result.fieldNames).toEqual(['Name', 'Salary']);
    expect(result.data).toEqual([
      ['Ann', '90000'],
      ['Cy', '60000'],
      ['Bob', '30000'],
    ]);
  });

  it('supports a quoted DSL expression chained with then', async () => {
    const sheets = registry();
    const action = new MillerAction('Filter', ['employees'], 'rich', "filter '$Salary >= 60000' then cut -f Name");
    const result = await new MillerRunner().run(action, sheets);
    expect(result.fieldNames).toEqual(['Name']);
    expect(result.data).toEqual([['Ann'], ['Cy']]);
  });

  it('surfaces Miller stderr when the command fails', async () => {
    const sheets = registry();
    const action = new MillerAction('Bad', ['employees'], 'out', 'not-a-real-verb');
    await expect(new MillerRunner().run(action, sheets)).rejects.toThrow(/Miller command failed/);
  });

  it('joins two sheets, placing the left file via a {{sheetName}} placeholder', async () => {
    const sheets = new SheetRegistry();
    sheets.set('depts', {
      name: 'depts',
      fieldNames: ['DeptId', 'DeptName'],
      data: [['1', 'Eng'], ['2', 'Sales']],
    });
    sheets.set('people', {
      name: 'people',
      fieldNames: ['DeptId', 'Name'],
      data: [['1', 'Ann'], ['2', 'Bob'], ['1', 'Cy']],
    });
    // `depts` is the left file (via -f); `people` is the streamed right input (appended).
    const action = new MillerAction('Join', ['depts', 'people'], 'joined', 'join -j DeptId -f {{depts}}');
    const result = await new MillerRunner().run(action, sheets);
    expect(result.fieldNames).toEqual(['DeptId', 'DeptName', 'Name']);
    // Miller emits joined records in the order they appear in the streamed (right) input.
    expect(result.data).toEqual([
      ['1', 'Eng', 'Ann'],
      ['2', 'Sales', 'Bob'],
      ['1', 'Eng', 'Cy'],
    ]);
  });
});
