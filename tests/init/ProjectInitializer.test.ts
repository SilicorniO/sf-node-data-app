import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeProject } from '../../src/init/ProjectInitializer';
import { getTemplate } from '../../src/init/ProjectTemplates';

const temporaryFolders: string[] = [];

function makeFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-init-'));
  temporaryFolders.push(folder);
  return folder;
}

afterEach(() => {
  while (temporaryFolders.length) {
    fs.rmSync(temporaryFolders.pop()!, { recursive: true, force: true });
  }
});

const EXPECTED_FILES = [
  'conf.yaml',
  'scripts.js',
  'AI_GUIDE.md',
  'skills/build-config/SKILL.md',
  'skills/build-config/templates/conf.yaml',
  'skills/build-script/SKILL.md',
  'skills/build-script/templates/scripts.js',
];

describe('initializeProject', () => {
  it('creates the full base project in an empty folder', () => {
    const cwd = makeFolder();

    const result = initializeProject(cwd);

    // Folders.
    expect(fs.existsSync(path.join(cwd, 'input'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'output'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'skills'))).toBe(true);
    // Files.
    for (const file of EXPECTED_FILES) {
      expect(fs.existsSync(path.join(cwd, file))).toBe(true);
    }
    // AI_GUIDE lives at the project root, not inside skills/.
    expect(fs.existsSync(path.join(cwd, 'skills', 'AI_GUIDE.md'))).toBe(false);

    expect(result.created).toEqual(expect.arrayContaining(['input/', 'output/', ...EXPECTED_FILES]));
    expect(result.skipped).toEqual([]);
  });

  it('writes template content byte-for-byte from the ai/ sources', () => {
    const cwd = makeFolder();

    initializeProject(cwd);

    expect(fs.readFileSync(path.join(cwd, 'conf.yaml'), 'utf8')).toBe(
      getTemplate('skills/build-config/templates/conf.yaml')
    );
    expect(fs.readFileSync(path.join(cwd, 'scripts.js'), 'utf8')).toBe(
      getTemplate('skills/build-script/templates/scripts.js')
    );
    expect(fs.readFileSync(path.join(cwd, 'AI_GUIDE.md'), 'utf8')).toBe(getTemplate('AI_GUIDE.md'));
  });

  it('never overwrites existing files and still creates missing siblings', () => {
    const cwd = makeFolder();
    const sentinel = '# my hand-edited config\n';
    fs.writeFileSync(path.join(cwd, 'conf.yaml'), sentinel, 'utf8');

    const result = initializeProject(cwd);

    expect(fs.readFileSync(path.join(cwd, 'conf.yaml'), 'utf8')).toBe(sentinel);
    expect(result.skipped).toContain('conf.yaml');
    expect(result.created).toContain('scripts.js');
    expect(result.created).toContain('AI_GUIDE.md');
  });

  it('is idempotent: a re-run creates nothing and throws nothing', () => {
    const cwd = makeFolder();
    initializeProject(cwd);

    const result = initializeProject(cwd);

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining(['input/', 'output/', ...EXPECTED_FILES]));
  });
});
