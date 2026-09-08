import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ExecConfReader } from '../../src/reader/ExecConfReader';
import { DeleteAction } from '../../src/model/DeleteAction';
import { GetAction } from '../../src/model/GetAction';
import { InsertAction } from '../../src/model/InsertAction';
import { TransformAction } from '../../src/model/TransformAction';
import { UpdateAction } from '../../src/model/UpdateAction';
import { UpsertAction } from '../../src/model/UpsertAction';

const allActionsYaml = `
actions:
  - type: get
    name: Get Accounts
    outputSheet: Accounts
    query: SELECT Id, Name FROM Account
  - type: transform
    name: Transform Accounts
    inputSheet: Accounts
    outputSheet: Accounts Ready
  - type: insert
    name: Insert Accounts
    object: Account
    inputSheet: Accounts Ready
    outputSheet: Insert IDs
    fields: [Name]
  - type: update
    name: Update Accounts
    object: Account
    inputSheet: Accounts Ready
    fields: [Id, Name]
  - type: upsert
    name: Upsert Accounts
    object: Account
    inputSheet: Accounts Ready
    externalIdField: External_Id__c
    fields: [External_Id__c, Name]
  - type: delete
    name: Delete Accounts
    object: Account
    inputSheet: Accounts Ready
`;

describe('ExecConfReader', () => {
  it('creates one concrete class per action type and applies defaults', () => {
    const configuration = ExecConfReader.parseConf(allActionsYaml, '/configuration/scripts.js');

    expect(configuration.actions).toHaveLength(6);
    expect(configuration.actions[0]).toBeInstanceOf(GetAction);
    expect(configuration.actions[1]).toBeInstanceOf(TransformAction);
    expect(configuration.actions[2]).toBeInstanceOf(InsertAction);
    expect(configuration.actions[3]).toBeInstanceOf(UpdateAction);
    expect(configuration.actions[4]).toBeInstanceOf(UpsertAction);
    expect(configuration.actions[5]).toBeInstanceOf(DeleteAction);
    expect(configuration.actions[0]).toMatchObject({
      waitBeforeSeconds: 0,
      continueOnError: false,
      errorRows: 'errors',
      errorSheet: 'Get Accounts-errors',
    });
    expect((configuration.actions[1] as TransformAction).scriptFile).toBe(
      path.resolve('/configuration/scripts.js')
    );
  });

  it('trims values and parses app and sheet mapping defaults', () => {
    const configuration = ExecConfReader.parseConf(`
appConfiguration:
  processingType: api
sheets:
  - name: " contacts "
    fields:
      - name: " Account Name "
        apiName: " AccountId "
actions: []
`);
    expect(configuration.appConfiguration).toMatchObject({
      processingType: 'api',
      bulkApiMaxWaitSec: null,
      bulkApiPollIntervalSec: null,
      apiVersion: '58.0',
      queryApiBatchSize: 2000,
    });
    expect(configuration.sheets[0].name).toBe('contacts');
    expect(configuration.sheets[0].fields[0]).toMatchObject({
      name: 'Account Name',
      apiName: 'AccountId',
    });
  });

  it('defaults processing to the synchronous API', () => {
    const configuration = ExecConfReader.parseConf(`
appConfiguration:
  cleanOutputFolderBeforeExecution: true
  deleteErrorFilesBeforeExecution: true
actions: []
`);
    expect(configuration.appConfiguration.processingType).toBe('api');
    expect(configuration.appConfiguration.cleanOutputFolderBeforeExecution).toBe(true);
    expect(configuration.appConfiguration.deleteErrorFilesBeforeExecution).toBe(true);
  });

  it('parses a custom Query API batch size', () => {
    const configuration = ExecConfReader.parseConf(`
appConfiguration:
  processingType: api
  queryApiBatchSize: 500
actions: []
`);
    expect(configuration.appConfiguration.queryApiBatchSize).toBe(500);
  });

  it.each([199, 2001])('rejects Query API batch size %s', value => {
    expect(() => ExecConfReader.parseConf(`
appConfiguration:
  processingType: api
  queryApiBatchSize: ${value}
actions: []
`)).toThrow(/Error parsing configuration/);
  });

  it('uses an empty field list when write actions omit fields', () => {
    const configuration = ExecConfReader.parseConf(`
actions:
  - { type: insert, name: Insert, object: Account, inputSheet: A }
  - { type: update, name: Update, object: Account, inputSheet: A }
  - { type: upsert, name: Upsert, object: Account, inputSheet: A, externalIdField: External_Id__c }
`);
    expect(configuration.actions.map(action => 'fields' in action ? action.fields : undefined))
      .toEqual([[], [], []]);
  });

  it.each<[string, string, string?]>([
    ['legacy objectsConf', `objectsConf: []`],
    ['legacy Salesforce CLI processing type', `appConfiguration:\n  processingType: sf`],
    ['legacy compound action', `actions:\n  - name: Old\n    exportAction:\n      query: SELECT Id FROM Account`],
    ['duplicate action name', `actions:\n  - { type: get, name: Same, outputSheet: A, query: "SELECT Id FROM Account" }\n  - { type: get, name: same, outputSheet: B, query: "SELECT Id FROM Contact" }`],
    ['unsafe name', `actions:\n  - { type: get, name: "../escape", outputSheet: A, query: "SELECT Id FROM Account" }`],
    ['insert Id field', `actions:\n  - { type: insert, name: Insert, object: Account, inputSheet: A, fields: [Id, Name] }`],
    ['update without Id', `actions:\n  - { type: update, name: Update, object: Account, inputSheet: A, fields: [Name] }`],
    ['upsert without external field', `actions:\n  - { type: upsert, name: Upsert, object: Account, inputSheet: A, externalIdField: Key__c, fields: [Name] }`],
    ['delete with fields', `actions:\n  - { type: delete, name: Delete, object: Account, inputSheet: A, fields: [Id] }`],
    ['update with output', `actions:\n  - { type: update, name: Update, object: Account, inputSheet: A, outputSheet: B, fields: [Id] }`],
    ['error sheet collision', `actions:\n  - { type: transform, name: Transform, inputSheet: A, outputSheet: B, errorSheet: b }`, './scripts.js'],
    ['transform without a script file', `actions:\n  - { type: transform, name: Transform, inputSheet: A, outputSheet: B }`, undefined],
    ['unknown scriptFile key in YAML', `scriptFile: ./scripts.js\nactions: []`, undefined],
  ])('rejects %s', (_description, yaml, scriptFile) => {
    expect(() => ExecConfReader.parseConf(yaml, scriptFile)).toThrow(/Error parsing configuration/);
  });

  it('parses every bundled example using the canonical schema', () => {
    const examplesDirectory = path.resolve(process.cwd(), 'examples');
    const configurationPaths = fs.readdirSync(examplesDirectory)
      .map(entry => path.join(examplesDirectory, entry, 'conf.yaml'))
      .filter(file => fs.existsSync(file));

    expect(configurationPaths).toHaveLength(7);
    for (const configurationPath of configurationPaths) {
      // Examples keep their shared transform script next to conf.yaml; pass it like the CLI would.
      const scriptPath = path.join(path.dirname(configurationPath), 'scripts.js');
      const scriptFile = fs.existsSync(scriptPath) ? scriptPath : undefined;
      expect(() => ExecConfReader.readConfFile(configurationPath, scriptFile), configurationPath).not.toThrow();
    }
  });
});
