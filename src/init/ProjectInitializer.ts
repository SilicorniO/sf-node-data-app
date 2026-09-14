// src/init/ProjectInitializer.ts
//
// Scaffolds a base sf-data project in a target folder: the input/ and output/ folders, a
// starter conf.yaml and scripts.js, the AI_GUIDE.md at the root, and a skills/ folder with
// the build-config and build-script skills. Existing files are never overwritten — only
// missing files and folders are created — so the command is safe to re-run.
//
// This module is pure filesystem logic (no process.env / process.cwd reads) so tests can
// drive it with an explicit temp cwd, mirroring the exported helpers in daemon/Server.ts.
import * as fs from 'fs';
import * as path from 'path';
import { getTemplate, PROJECT_FOLDERS, TEMPLATE_MANIFEST } from './ProjectTemplates';

export interface InitResult {
  /** Paths (relative to the project root) that were created by this run. */
  created: string[];
  /** Paths (relative to the project root) that already existed and were left untouched. */
  skipped: string[];
}

/** Creates a folder if it is missing; returns whether it was created. */
function ensureFolder(absPath: string): boolean {
  if (fs.existsSync(absPath)) {
    return false;
  }
  fs.mkdirSync(absPath, { recursive: true });
  return true;
}

/**
 * Scaffolds the base project layout in `cwd`. Folders are created idempotently; files are
 * written only when absent so hand-edited content is preserved on a re-run.
 */
export function initializeProject(cwd: string): InitResult {
  const created: string[] = [];
  const skipped: string[] = [];

  // 1. Top-level folders (input/, output/).
  for (const folder of PROJECT_FOLDERS) {
    if (ensureFolder(path.join(cwd, folder))) {
      created.push(`${folder}/`);
    } else {
      skipped.push(`${folder}/`);
    }
  }

  // 2. Files (and any parent folders they need, e.g. skills/build-config/templates).
  for (const entry of TEMPLATE_MANIFEST) {
    const target = path.join(cwd, entry.destination);
    if (fs.existsSync(target)) {
      skipped.push(entry.destination);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, getTemplate(entry.source), 'utf8');
    created.push(entry.destination);
  }

  return { created, skipped };
}
