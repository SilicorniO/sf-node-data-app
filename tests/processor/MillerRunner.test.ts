import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { MillerAction } from '../../src/model/MillerAction';
import { MillerRunner, tokenizeCommand } from '../../src/processor/MillerRunner';
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
});
