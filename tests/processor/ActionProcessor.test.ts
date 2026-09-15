import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfiguration } from '../../src/model/AppConfiguration';
import { CheckAction } from '../../src/model/CheckAction';
import { ExecConf } from '../../src/model/ExecConf';
import { InsertAction } from '../../src/model/InsertAction';
import { MergeAction } from '../../src/model/MergeAction';
import { TableAction } from '../../src/model/TableAction';
import { SqlAction } from '../../src/model/SqlAction';
import { TransformAction } from '../../src/model/TransformAction';
import { UpdateAction } from '../../src/model/UpdateAction';
import { UpsertAction } from '../../src/model/UpsertAction';
import {
  ActionProcessor,
  ConfigurationPreflightError,
  describeActionRange,
  isBulkQueryUnsupported,
  PipelineExecutionError,
  resolveActionRange,
} from '../../src/processor/ActionProcessor';
import { SheetRegistry } from '../../src/processor/SheetRegistry';

describe('ActionProcessor write preparation', () => {
  it('ignores a populated CSV Id column when Id is not selected for INSERT', () => {
    const action = new InsertAction(
      'Insert Accounts',
      'Account',
      'Accounts',
      ['Name', 'Type']
    );
    const input = {
      name: 'Accounts',
      fieldNames: ['Id', 'Name', 'Type'],
      data: [['001-existing', 'Acme', 'Customer']],
    };

    const prepared = (ActionProcessor as any).prepareWriteRequest(action, input);

    expect(prepared.localErrors).toEqual([]);
    expect(prepared.request.rows).toEqual([{
      inputIndex: 0,
      values: {
        Name: 'Acme',
        Type: 'Customer',
      },
    }]);
  });

  it('uses every input field including Id for INSERT when fields are omitted', () => {
    const action = new InsertAction('Insert Accounts', 'Account', 'Accounts', []);
    const prepared = (ActionProcessor as any).prepareWriteRequest(action, {
      name: 'Accounts',
      fieldNames: ['Id', 'Name', 'Type'],
      data: [['001-existing', 'Acme', 'Customer']],
    });

    expect(prepared.request.fields).toEqual(['Id', 'Name', 'Type']);
    expect(prepared.request.rows[0].values).toEqual({
      Id: '001-existing',
      Name: 'Acme',
      Type: 'Customer',
    });
  });

  it('uses every input field for UPDATE when fields are omitted', () => {
    const action = new UpdateAction('Update Accounts', 'Account', 'Accounts', []);
    const prepared = (ActionProcessor as any).prepareWriteRequest(action, {
      name: 'Accounts',
      fieldNames: ['Id', 'Name', 'Type'],
      data: [['001-existing', 'Acme', 'Customer']],
    });

    expect(prepared.localErrors).toEqual([]);
    expect(prepared.request.fields).toEqual(['Id', 'Name', 'Type']);
  });

  it('treats an empty input sheet as a no-op instead of failing INSERT', async () => {
    const action = new InsertAction('Insert Accounts', 'Account', 'Accounts To Import', [], 'Accounts Imported');
    const sheets = new SheetRegistry({
      'Accounts To Import': { name: 'Accounts To Import', fieldNames: [], data: [] },
    });
    const execConf = new ExecConf(new AppConfiguration('api', null, null, '58.0'), [action], []);

    const hadRowErrors = await (ActionProcessor as any).executeWrite(execConf, action, sheets);

    expect(hadRowErrors).toBe(false);
    expect(sheets.get('Accounts Imported')?.data).toEqual([]);
  });

  it('uses every input field for UPSERT when fields are omitted', () => {
    const action = new UpsertAction(
      'Upsert Accounts',
      'Account',
      'Accounts',
      [],
      'External_Id__c'
    );
    const prepared = (ActionProcessor as any).prepareWriteRequest(action, {
      name: 'Accounts',
      fieldNames: ['External_Id__c', 'Name', 'Type'],
      data: [['EXT-1', 'Acme', 'Customer']],
    });

    expect(prepared.localErrors).toEqual([]);
    expect(prepared.request.fields).toEqual(['External_Id__c', 'Name', 'Type']);
  });
});

describe('ActionProcessor auto write loader selection', () => {
  const execConf = (threshold: number) =>
    new ExecConf(new AppConfiguration('auto', null, null, '58.0', false, false, 2000, threshold), [], []);

  it('picks the synchronous API loader below the threshold', () => {
    const loader = (ActionProcessor as any).loader(execConf(10000), 9999);
    expect(loader.constructor.name).toBe('SalesforceApiLoader');
  });

  it('picks the Bulk API loader at or above the threshold', () => {
    const loader = (ActionProcessor as any).loader(execConf(10000), 10000);
    expect(loader.constructor.name).toBe('SalesforceBulkApiLoader');
  });

  it('honours the configured processingType without consulting the count', () => {
    const apiConf = new ExecConf(new AppConfiguration('api', null, null, '58.0'), [], []);
    const bulkConf = new ExecConf(new AppConfiguration('bulk', null, null, '58.0'), [], []);
    expect((ActionProcessor as any).loader(apiConf, 1_000_000).constructor.name).toBe('SalesforceApiLoader');
    expect((ActionProcessor as any).loader(bulkConf, 1).constructor.name).toBe('SalesforceBulkApiLoader');
  });
});

describe('resolveActionRange', () => {
  const actions = [{ name: 'Get Accounts' }, { name: 'Transform' }, { name: 'Insert Contacts' }];

  it('selects the full pipeline when neither bound is set', () => {
    expect(resolveActionRange(actions)).toEqual({ start: 0, end: 2 });
  });

  it('starts at fromTask and continues to the end', () => {
    expect(resolveActionRange(actions, 'Transform')).toEqual({ start: 1, end: 2 });
  });

  it('starts from the beginning when only toTask is set', () => {
    expect(resolveActionRange(actions, undefined, 'Transform')).toEqual({ start: 0, end: 1 });
  });

  it('selects an inclusive slice by name, ignoring case', () => {
    expect(resolveActionRange(actions, 'transform', 'insert contacts')).toEqual({ start: 1, end: 2 });
  });

  it('accepts 1-based indexes when the selector is not an action name', () => {
    expect(resolveActionRange(actions, '2', '3')).toEqual({ start: 1, end: 2 });
  });

  it('rejects a fromTask that is after toTask', () => {
    expect(() => resolveActionRange(actions, 'Insert Contacts', 'Get Accounts')).toThrow(
      /is after toTask/
    );
  });

  it('rejects an unknown action name', () => {
    expect(() => resolveActionRange(actions, 'Missing')).toThrow(/Unknown fromTask "Missing"/);
  });

  it('describes a partial range for logs', () => {
    expect(describeActionRange(actions, { start: 1, end: 2 })).toBe(
      'actions 2–3 of 3 ("Transform" through "Insert Contacts")'
    );
  });
});

describe('Bulk query fallback detection', () => {
  it('recognizes the Salesforce compound-field limitation', () => {
    expect(isBulkQueryUnsupported(
      new Error('Error during Bulk API v2 GET: [API_ERROR] Selecting compound data not supported in Bulk Query')
    )).toBe(true);
  });

  it('does not hide unrelated Bulk Query failures', () => {
    expect(isBulkQueryUnsupported(
      new Error('Error during Bulk API v2 GET: INVALID_SESSION_ID')
    )).toBe(false);
  });
});

describe('ActionProcessor action range execution', () => {
  let tempDir = '';
  let firstScript = '';
  let secondScript = '';
  let thirdScript = '';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-range-'));
    firstScript = path.join(tempDir, 'first.js');
    secondScript = path.join(tempDir, 'second.js');
    thirdScript = path.join(tempDir, 'third.js');
    fs.writeFileSync(firstScript, 'module.exports = { "First": function (row) { row.step = "first"; return row; } };');
    fs.writeFileSync(secondScript, 'module.exports = { "Second": function (row) { row.step = "second"; return row; } };');
    fs.writeFileSync(thirdScript, 'module.exports = { "Third": function (row) { row.step = "third"; return row; } };');
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function configuration(): ExecConf {
    return new ExecConf(
      new AppConfiguration('api', null, null, '58.0'),
      [
        new TransformAction('First', 'input', 'one', firstScript),
        new TransformAction('Second', 'one', 'two', secondScript),
        new TransformAction('Third', 'two', 'three', thirdScript),
      ],
      []
    );
  }

  function sheetsWithInput(): SheetRegistry {
    return new SheetRegistry({
      input: {
        name: 'input',
        fieldNames: ['Name'],
        data: [['Acme']],
      },
    });
  }

  it('runs only from fromTask through the end', async () => {
    const sheets = new SheetRegistry({
      one: { name: 'one', fieldNames: ['Name'], data: [['Acme']] },
    });

    await ActionProcessor.processActions(configuration(), sheets, { fromTask: 'Second' });

    expect(sheets.get('two')?.data).toEqual([['Acme', 'second']]);
    expect(sheets.get('three')?.data).toEqual([['Acme', 'third']]);
    expect(sheets.get('one')?.data).toEqual([['Acme']]);
  });

  it('runs from the beginning through toTask when fromTask is omitted', async () => {
    const sheets = sheetsWithInput();

    await ActionProcessor.processActions(configuration(), sheets, { toTask: 'Second' });

    expect(sheets.get('one')?.data[0]).toContain('first');
    expect(sheets.get('two')?.data[0]).toContain('second');
    expect(sheets.get('three')).toBeUndefined();
  });

  it('runs an inclusive middle slice', async () => {
    const sheets = new SheetRegistry({
      one: { name: 'one', fieldNames: ['Name'], data: [['Acme']] },
    });

    await ActionProcessor.processActions(configuration(), sheets, {
      fromTask: 'Second',
      toTask: 'Second',
    });

    expect(sheets.get('two')?.data[0]).toContain('second');
    expect(sheets.get('three')).toBeUndefined();
  });

  it('fails precheck for an unknown fromTask', async () => {
    await expect(
      ActionProcessor.processActions(configuration(), sheetsWithInput(), { fromTask: 'Missing' })
    ).rejects.toBeInstanceOf(ConfigurationPreflightError);
  });

  it('loads a sheet lazily, streams each output, and releases inputs when done', async () => {
    const registry = new SheetRegistry();
    let inputLoads = 0;
    registry.registerLoader('input', async () => {
      inputLoads++;
      return { name: 'input', fieldNames: ['Name'], data: [['Acme']] };
    });

    // Nothing is read until an action needs it.
    expect(registry.has('input')).toBe(false);
    expect(inputLoads).toBe(0);

    const streamed: string[] = [];
    await ActionProcessor.processActions(configuration(), registry, {
      onSheetProduced: (name) => { streamed.push(name); },
    });

    // The input was loaded exactly once, on demand.
    expect(inputLoads).toBe(1);
    // Each produced sheet was streamed out (outputs plus any error sheets).
    expect(streamed).toContain('one');
    expect(streamed).toContain('two');
    expect(streamed).toContain('three');
    // Every sheet was released once its last consumer ran; nothing lingers in memory.
    expect(registry.loadedNames()).toEqual([]);
  });

  it('keeps input headers on a transform output that emits no rows', async () => {
    const dropScript = path.join(tempDir, 'drop.js');
    fs.writeFileSync(dropScript, 'module.exports = { "Drop": function () { return null; } };');
    const config = new ExecConf(
      new AppConfiguration('api', null, null, '58.0'),
      [new TransformAction('Drop', 'input', 'out', dropScript)],
      []
    );
    const sheets = new SheetRegistry({
      input: { name: 'input', fieldNames: ['Id', 'Name', 'Type'], data: [['001', 'Acme', 'Customer']] },
    });

    await ActionProcessor.processActions(config, sheets);

    const out = sheets.get('out');
    expect(out?.data).toEqual([]);
    expect(out?.fieldNames).toEqual(['Id', 'Name', 'Type']);
  });

  it('reloads a released file-backed sheet when a later transform looks it up', async () => {
    const registry = new SheetRegistry();
    let loads = 0;
    const loadRef = () => {
      loads++;
      return { name: 'ref', fieldNames: ['Key', 'Value'], data: [['a', '42']] };
    };
    registry.registerLoader('ref', async () => loadRef(), () => loadRef());
    registry.set('input', { name: 'input', fieldNames: ['Key'], data: [['a']] });

    const script = path.join(tempDir, 'lookup.js');
    fs.writeFileSync(
      script,
      'module.exports = { "Resolve": function (row, { lookup }) {'
      + ' const r = lookup("ref", "Key", row.Key);'
      + ' return { Key: row.Key, Value: r ? r.Value : "" }; } };'
    );
    const config = new ExecConf(
      new AppConfiguration('api', null, null, '58.0'),
      [new TransformAction('Resolve', 'input', 'out', script)],
      []
    );

    let out: { [name: string]: string[][] } = {};
    await ActionProcessor.processActions(config, registry, {
      onSheetProduced: (name, sheet) => { out[name] = sheet.data; },
    });

    expect(out.out).toEqual([['a', '42']]);
    expect(loads).toBeGreaterThan(0);
  });
});

describe('ActionProcessor check execution', () => {
  let tempDir = '';
  let checkScript = '';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-check-'));
    checkScript = path.join(tempDir, 'checks.js');
    fs.writeFileSync(
      checkScript,
      'module.exports = {'
      + ' "Enough Rows": function (sheets) { return sheets["input"].data.length > 1; },'
      + ' "Same Row Count": function (sheets) { return sheets["input"].data.length === sheets["other"].data.length; }'
      + ' };'
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function sheets(rows: string[][]): SheetRegistry {
    return new SheetRegistry({
      input: { name: 'input', fieldNames: ['Name'], data: rows },
    });
  }

  function config(action: CheckAction): ExecConf {
    return new ExecConf(new AppConfiguration('api', null, null, '58.0'), [action], []);
  }

  it('passes silently when the check returns true and writes no error sheet', async () => {
    const registry = sheets([['Acme'], ['Globex']]);
    const action = new CheckAction('Enough Rows', ['input'], checkScript);

    const result = await ActionProcessor.processActions(config(action), registry);

    expect(result.hadContinuedErrors).toBe(false);
    expect(registry.get('Enough Rows-errors')).toBeUndefined();
  });

  it('stops the pipeline when the check fails and continueOnError is false', async () => {
    const registry = sheets([['Acme']]);
    const action = new CheckAction('Enough Rows', ['input'], checkScript);

    await expect(ActionProcessor.processActions(config(action), registry))
      .rejects.toBeInstanceOf(PipelineExecutionError);
  });

  it('continues and records a one-row error sheet when continueOnError is true', async () => {
    const registry = sheets([['Acme']]);
    const action = new CheckAction('Enough Rows', ['input'], checkScript, { continueOnError: true });

    const result = await ActionProcessor.processActions(config(action), registry);

    expect(result.hadContinuedErrors).toBe(true);
    const errors = registry.get('Enough Rows-errors');
    expect(errors?.fieldNames).toEqual(['_ErrorMessage']);
    expect(errors?.data).toEqual([['Check "Enough Rows" failed.']]);
  });

  it('reads multiple input sheets in a single check', async () => {
    const registry = new SheetRegistry({
      input: { name: 'input', fieldNames: ['Name'], data: [['Acme'], ['Globex']] },
      other: { name: 'other', fieldNames: ['Name'], data: [['One'], ['Two']] },
    });
    const action = new CheckAction('Same Row Count', ['input', 'other'], checkScript);

    const result = await ActionProcessor.processActions(config(action), registry);

    expect(result.hadContinuedErrors).toBe(false);
    expect(registry.get('Same Row Count-errors')).toBeUndefined();
  });
});

describe('ActionProcessor merge execution', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-merge-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function mergeConfig(): ExecConf {
    return new ExecConf(
      new AppConfiguration('api', null, null, '58.0'),
      [new MergeAction('Combine', 'primary', 'secondary', 'merged', 'Id')],
      []
    );
  }

  // Primary keeps its own non-empty cells; the secondary fills only blanks and adds
  // its extra column. Unmatched secondary ids are appended; empty-id rows pass through.
  const primaryData = [
    ['1', 'Acme', ''],
    ['2', '', 'east'],
    ['', 'NoId', 'west'],
  ];
  const secondaryData = [
    ['1', 'IGNORED', 'gold'], // Name is non-empty in primary → primary wins; Tier is new.
    ['2', 'Globex', 'silver'], // fills primary's empty Name; Tier added.
    ['3', 'Initech', 'bronze'], // unmatched → appended.
    ['', 'Orphan', 'none'], // empty id → passthrough.
  ];

  const expectedFieldNames = ['Id', 'Name', 'Region', 'Tier'];
  const expectedData = [
    ['1', 'Acme', '', 'gold'],
    ['2', 'Globex', 'east', 'silver'],
    ['', 'NoId', 'west', ''],
    ['3', 'Initech', '', 'bronze'],
    ['', 'Orphan', '', 'none'],
  ];

  it('merges two in-memory sheets preserving column order and primary-wins semantics', async () => {
    const registry = new SheetRegistry({
      primary: { name: 'primary', fieldNames: ['Id', 'Name', 'Region'], data: primaryData },
      secondary: { name: 'secondary', fieldNames: ['Id', 'Name', 'Tier'], data: secondaryData },
    });

    await ActionProcessor.processActions(mergeConfig(), registry);

    const merged = registry.get('merged');
    expect(merged?.fieldNames).toEqual(expectedFieldNames);
    expect(merged?.data).toEqual(expectedData);
    registry.disposeIndexes();
  });

  it('produces identical output when both sides use a created SQLite table', async () => {
    const primaryCsv = path.join(tempDir, 'primary.csv');
    const secondaryCsv = path.join(tempDir, 'secondary.csv');
    fs.writeFileSync(primaryCsv, 'Id,Name,Region\n' + primaryData.map(r => r.join(',')).join('\n') + '\n');
    fs.writeFileSync(secondaryCsv, 'Id,Name,Tier\n' + secondaryData.map(r => r.join(',')).join('\n') + '\n');

    const cacheDir = fs.mkdtempSync(path.join(tempDir, 'cache-'));
    const registry = new SheetRegistry({}, cacheDir);
    registry.registerLoader('primary', async () => ({
      name: 'primary', fieldNames: ['Id', 'Name', 'Region'], data: primaryData,
    }));
    registry.registerLoader('secondary', async () => ({
      name: 'secondary', fieldNames: ['Id', 'Name', 'Tier'], data: secondaryData,
    }));
    // A CSV source lets the `table` action stream each side straight into SQLite.
    registry.registerCsvSource('primary', primaryCsv);
    registry.registerCsvSource('secondary', secondaryCsv);

    // Explicit `table` actions route the merge through the SQLite-backed index.
    const config = new ExecConf(
      new AppConfiguration('api', null, null, '58.0'),
      [
        new TableAction('Index primary', 'primary', []),
        new TableAction('Index secondary', 'secondary', []),
        new MergeAction('Combine', 'primary', 'secondary', 'merged', 'Id'),
      ],
      []
    );

    const merged: { [name: string]: import('../../src/model/DataSheet').DataSheet } = {};
    await ActionProcessor.processActions(config, registry, {
      onSheetProduced: (name, sheet) => { merged[name] = sheet; },
    });

    expect(merged.merged.fieldNames).toEqual(expectedFieldNames);
    expect(merged.merged.data).toEqual(expectedData);
    registry.disposeIndexes();
  });

  it('detects a duplicate id on the secondary side', async () => {
    const registry = new SheetRegistry({
      primary: { name: 'primary', fieldNames: ['Id', 'Name'], data: [['1', 'Acme']] },
      secondary: { name: 'secondary', fieldNames: ['Id', 'Tier'], data: [['1', 'gold'], ['1', 'silver']] },
    });

    await expect(ActionProcessor.processActions(mergeConfig(), registry))
      .rejects.toBeInstanceOf(PipelineExecutionError);
    registry.disposeIndexes();
  });
});

describe('ActionProcessor table + sql execution', () => {
  let tempDir = '';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-sql-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function registryWithCache(sheets: { [name: string]: import('../../src/model/DataSheet').DataSheet } = {}) {
    const cacheDir = fs.mkdtempSync(path.join(tempDir, 'cache-'));
    return new SheetRegistry(sheets, cacheDir);
  }

  function config(...actions: import('../../src/model/Action').Action[]): ExecConf {
    return new ExecConf(new AppConfiguration('api', null, null, '58.0'), actions, []);
  }

  it('creates a table from a produced/in-memory sheet and queries it with real column names', async () => {
    const registry = registryWithCache({
      employees: {
        name: 'employees',
        fieldNames: ['Name', 'Department', 'Salary'],
        data: [
          ['Alice', 'Engineering', '90000'],
          ['Bob', 'Sales', '40000'],
          ['Carol', 'Engineering', '55000'],
        ],
      },
    });

    await ActionProcessor.processActions(
      config(
        new TableAction('Index employees', 'employees', [{ source: 'Salary', type: 'INTEGER' }]),
        new SqlAction(
          'Top earners',
          ['employees'],
          'top',
          'SELECT "Department", COUNT(*) AS "Count" FROM employees WHERE "Salary" > 50000 GROUP BY "Department" ORDER BY "Department"'
        )
      ),
      registry
    );

    const top = registry.get('top');
    expect(top?.fieldNames).toEqual(['Department', 'Count']);
    expect(top?.data).toEqual([['Engineering', '2']]);
    registry.disposeIndexes();
  });

  it('applies column renames in the created table', async () => {
    const registry = registryWithCache({
      people: { name: 'people', fieldNames: ['First Name', 'Age'], data: [['Alice', '30']] },
    });

    await ActionProcessor.processActions(
      config(
        new TableAction('Index people', 'people', [{ source: 'First Name', name: 'first_name' }]),
        new SqlAction('Read', ['people'], 'out', 'SELECT first_name FROM people')
      ),
      registry
    );

    expect(registry.get('out')?.fieldNames).toEqual(['first_name']);
    expect(registry.get('out')?.data).toEqual([['Alice']]);
    registry.disposeIndexes();
  });

  it('errors when a sql action queries a sheet without a table', async () => {
    const registry = registryWithCache({
      people: { name: 'people', fieldNames: ['Id'], data: [['1']] },
    });

    await expect(
      ActionProcessor.processActions(
        config(new SqlAction('Read', ['people'], 'out', 'SELECT * FROM people')),
        registry
      )
    ).rejects.toBeInstanceOf(PipelineExecutionError);
    registry.disposeIndexes();
  });

  it('fails fast on a rename collision', async () => {
    const registry = registryWithCache({
      people: { name: 'people', fieldNames: ['A', 'B'], data: [['1', '2']] },
    });

    await expect(
      ActionProcessor.processActions(
        config(new TableAction('Index people', 'people', [{ source: 'B', name: 'A' }])),
        registry
      )
    ).rejects.toBeInstanceOf(PipelineExecutionError);
    registry.disposeIndexes();
  });
});
