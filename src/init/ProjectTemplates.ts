// src/init/ProjectTemplates.ts
//
// Resolves the scaffolding templates from the repo's `ai/` sources. The content is NEVER
// inlined here: it is read at runtime from the `ai/` folder that the build step copies next
// to the compiled code (and that `pkg` embeds as an asset). This way any future edit to
// `ai/AI_GUIDE.md`, either SKILL.md, or either template is picked up automatically the next
// time the app is compiled/packaged — there is no frozen snapshot to keep in sync.
import * as fs from 'fs';
import * as path from 'path';

/** A single scaffolded file: read from `source` (under `ai/`), written to `destination`
 *  (relative to the project folder). */
export interface TemplateEntry {
  /** Path of the source file relative to the `ai/` root. */
  source: string;
  /** Path where the file is written, relative to the project (cwd) root. */
  destination: string;
}

/** The build-config template doubles as the project's starter conf.yaml. */
const CONF_TEMPLATE_SOURCE = 'skills/build-config/templates/conf.yaml';
/** The build-script template doubles as the project's starter scripts.js. */
const SCRIPT_TEMPLATE_SOURCE = 'skills/build-script/templates/scripts.js';

/**
 * Every file the `init` command writes, in creation order. The two starter files at the
 * project root reuse the skill templates as their content; the `skills/` tree and the root
 * `AI_GUIDE.md` mirror the `ai/` sources verbatim.
 */
export const TEMPLATE_MANIFEST: TemplateEntry[] = [
  { source: CONF_TEMPLATE_SOURCE, destination: 'conf.yaml' },
  { source: SCRIPT_TEMPLATE_SOURCE, destination: 'scripts.js' },
  { source: 'AI_GUIDE.md', destination: 'AI_GUIDE.md' },
  { source: 'skills/build-config/SKILL.md', destination: 'skills/build-config/SKILL.md' },
  { source: CONF_TEMPLATE_SOURCE, destination: 'skills/build-config/templates/conf.yaml' },
  { source: 'skills/build-script/SKILL.md', destination: 'skills/build-script/SKILL.md' },
  { source: SCRIPT_TEMPLATE_SOURCE, destination: 'skills/build-script/templates/scripts.js' },
];

/** Folders the `init` command ensures exist (relative to the project root). */
export const PROJECT_FOLDERS = ['input', 'output'] as const;

/**
 * Resolves the `ai/` root that holds the source templates, preferring the copy bundled next
 * to the compiled code (dist / pkg snapshot) and falling back to the repo root for
 * `ts-node`/vitest runs where `__dirname` is the source location. Mirrors the candidate-list
 * approach in `resolveGeneratorHtml` (src/daemon/Server.ts).
 */
function resolveAiRoot(): string {
  const candidates = [
    path.resolve(__dirname, '../ai'), // dist/init -> dist/ai (build step output / pkg snapshot)
    path.resolve(__dirname, '../../ai'), // src/init -> repo/ai (ts-node / vitest)
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not locate the "ai" templates folder. Looked in:\n  ${candidates.join('\n  ')}`
    );
  }
  return found;
}

/** Reads a template's content from the bundled `ai/` sources. */
export function getTemplate(source: string): string {
  const filePath = path.join(resolveAiRoot(), source);
  return fs.readFileSync(filePath, 'utf8');
}
