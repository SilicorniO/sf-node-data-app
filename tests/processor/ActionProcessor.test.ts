import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfiguration } from '../../src/model/AppConfiguration';
import { ExecConf } from '../../src/model/ExecConf';
import { InsertAction } from '../../src/model/InsertAction';
import { TransformAction } from '../../src/model/TransformAction';
import { UpdateAction } from '../../src/model/UpdateAction';
import { UpsertAction } from '../../src/model/UpsertAction';
import {
  ActionProcessor,
  ConfigurationPreflightError,
  describeActionRange,
  isBulkQueryUnsupported,
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
