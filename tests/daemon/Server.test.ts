import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCliArgs, captureOutput, detectEnvCredential, readFolderConfig, writeFolderConfig } from '../../src/daemon/Server';

const temporaryFolders: string[] = [];

function makeFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-daemon-'));
  temporaryFolders.push(folder);
  return folder;
}

afterEach(() => {
  while (temporaryFolders.length) {
    fs.rmSync(temporaryFolders.pop()!, { recursive: true, force: true });
  }
});

describe('buildCliArgs', () => {
  it('uses fixed conventions and omits the script when there is no transform', () => {
    const args = buildCliArgs({ yaml: 'x', hasTransform: false });
    expect(args).toEqual(['--confFile', 'conf.yaml', '--inputFolder', '.', '--outputFolder', './output']);
  });

  it('adds --scriptFile only when a transform exists', () => {
    const args = buildCliArgs({ yaml: 'x', hasTransform: true });
    expect(args).toContain('--scriptFile');
    expect(args).toContain('scripts.js');
  });

  it('passes the action range when provided', () => {
    const args = buildCliArgs({ yaml: 'x', hasTransform: false, fromTask: 'Insert', toTask: 3 });
    expect(args).toContain('--fromTask');
    expect(args[args.indexOf('--fromTask') + 1]).toBe('Insert');
    expect(args).toContain('--toTask');
    expect(args[args.indexOf('--toTask') + 1]).toBe('3');
  });

  it('omits range flags for empty values', () => {
    const args = buildCliArgs({ yaml: 'x', hasTransform: false, fromTask: '', toTask: undefined });
    expect(args).not.toContain('--fromTask');
    expect(args).not.toContain('--toTask');
  });
});

describe('captureOutput', () => {
  it('parses the CLI output-file lines', () => {
    const outputs: Array<{ name: string; rows: number }> = [];
    captureOutput('        + employees-transformed.csv: 5 row(s)', outputs);
    captureOutput('      Pipeline actions completed successfully.', outputs);
    captureOutput('        + Accounts.csv: 120 row(s)', outputs);
    expect(outputs).toEqual([
      { name: 'employees-transformed.csv', rows: 5 },
      { name: 'Accounts.csv', rows: 120 },
    ]);
  });
});

describe('detectEnvCredential', () => {
  it('returns null when there is no .env', () => {
    expect(detectEnvCredential(makeFolder())).toBeNull();
  });

  it('detects a bearer credential', () => {
    const folder = makeFolder();
    fs.writeFileSync(path.join(folder, '.env'), 'SF_ACCESS_TOKEN=abc\nSF_INSTANCE_URL=https://x.my.salesforce.com\n');
    expect(detectEnvCredential(folder)).toBe('bearer');
  });

  it('detects client credentials', () => {
    const folder = makeFolder();
    fs.writeFileSync(
      path.join(folder, '.env'),
      'SF_CLIENT_ID=id\nSF_CLIENT_SECRET=secret\nSF_INSTANCE_URL=https://x.my.salesforce.com\n'
    );
    expect(detectEnvCredential(folder)).toBe('clientCredentials');
  });

  it('ignores an incomplete credential', () => {
    const folder = makeFolder();
    fs.writeFileSync(path.join(folder, '.env'), 'SF_ACCESS_TOKEN=abc\n');
    expect(detectEnvCredential(folder)).toBeNull();
  });
});

describe('readFolderConfig', () => {
  it('reports no config for an empty folder', () => {
    expect(readFolderConfig(makeFolder())).toEqual({ hasConf: false, yaml: null, script: null });
  });

  it('returns conf.yaml and scripts.js when present', () => {
    const folder = makeFolder();
    fs.writeFileSync(path.join(folder, 'conf.yaml'), 'actions: []\n');
    fs.writeFileSync(path.join(folder, 'scripts.js'), 'module.exports = {};\n');
    const config = readFolderConfig(folder);
    expect(config.hasConf).toBe(true);
    expect(config.yaml).toContain('actions: []');
    expect(config.script).toContain('module.exports');
  });

  it('returns the conf without a script when only conf.yaml exists', () => {
    const folder = makeFolder();
    fs.writeFileSync(path.join(folder, 'conf.yaml'), 'actions: []\n');
    const config = readFolderConfig(folder);
    expect(config.hasConf).toBe(true);
    expect(config.script).toBeNull();
  });
});

describe('writeFolderConfig', () => {
  it('writes conf.yaml and skips scripts.js without a transform', () => {
    const folder = makeFolder();
    writeFolderConfig(folder, { yaml: 'actions: []\n', hasTransform: false });
    expect(fs.readFileSync(path.join(folder, 'conf.yaml'), 'utf8')).toContain('actions: []');
    expect(fs.existsSync(path.join(folder, 'scripts.js'))).toBe(false);
  });

  it('writes scripts.js when a transform exists', () => {
    const folder = makeFolder();
    writeFolderConfig(folder, { yaml: 'actions: []\n', script: 'module.exports = {};\n', hasTransform: true });
    expect(fs.readFileSync(path.join(folder, 'scripts.js'), 'utf8')).toContain('module.exports');
  });

  it('round-trips through readFolderConfig', () => {
    const folder = makeFolder();
    writeFolderConfig(folder, { yaml: 'actions: []\n', script: 'module.exports = {};\n', hasTransform: true });
    const config = readFolderConfig(folder);
    expect(config.hasConf).toBe(true);
    expect(config.yaml).toContain('actions: []');
    expect(config.script).toContain('module.exports');
  });
});
