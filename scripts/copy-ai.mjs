// scripts/copy-ai.mjs
//
// Copies the `ai/` folder (AI_GUIDE.md, skills, templates) next to the compiled CLI at
// `dist/ai/` so `sfdata init` can read the scaffolding templates from the bundle. Run as part
// of `build:cli` after `tsc`, so the copy is refreshed on every compile and edits to the `ai/`
// sources are never stale in the built artifact.
import { cpSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, '..');
const source = resolve(rootDirectory, 'ai');
const destination = resolve(rootDirectory, 'dist', 'ai');

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log(`Copied ai/ -> ${destination}`);
