import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSheet } from '../model/DataSheet';
import { MillerAction } from '../model/MillerAction';
import { CsvProcessor } from './CsvProcessor';
import { SheetRegistry } from './SheetRegistry';

const execFileAsync = promisify(execFile);
// Large enough to hold the transformed CSV that Miller streams to stdout.
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Runs Miller (`mlr`) as a CSV transformation over one or more sheets.
 *
 * The pipeline is sheet-based (in-memory DataSheets), so each input sheet is
 * materialized to a temporary CSV, `mlr --csv <command> <inputCsv...>` is run with
 * its arguments passed as an argv array (never through a shell), and the CSV it
 * writes to stdout is parsed back into the output DataSheet. Miller supplies the
 * `--csv` flag and the input file paths itself — the user only writes the verb chain.
 */
export class MillerRunner {
  private preflighted = false;

  /** Verifies `mlr` is installed and on PATH. Fails fast with a clear message. */
  async preflight(actions: MillerAction[]): Promise<void> {
    if (actions.length === 0 || this.preflighted) {
      return;
    }
    try {
      await execFileAsync('mlr', ['--version']);
    } catch (error: any) {
      throw new Error(
        'Miller (mlr) is required for "miller" actions but was not found on PATH. '
        + `Install it from https://miller.readthedocs.io (original error: ${error.message}).`
      );
    }
    this.preflighted = true;
  }

  /** Runs the action's Miller command and returns the produced DataSheet. */
  async run(action: MillerAction, sheets: SheetRegistry): Promise<DataSheet> {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-mlr-'));
    try {
      // Materialize each input sheet to a temp CSV, keyed by lowercased sheet name so
      // `{{sheetName}}` placeholders in the command can be substituted case-insensitively.
      const pathBySheet = new Map<string, string>();
      action.inputSheets.forEach((sheetName, index) => {
        const sheet = sheets.require(sheetName);
        const filePath = path.join(workDir, `input-${index}.csv`);
        fs.writeFileSync(filePath, CsvProcessor.generateCSV(sheet.fieldNames, sheet.data), 'utf8');
        pathBySheet.set(sheetName.toLocaleLowerCase(), filePath);
      });

      // Substitute `{{sheetName}}` placeholders with the input's CSV path. A referenced
      // input is positioned by the placeholder (e.g. Miller `join -f {{left}}`), so it is
      // not also appended; inputs with no placeholder still append at the end in order.
      const referenced = new Set<string>();
      const commandTokens = tokenizeCommand(action.command).map(token =>
        substitutePlaceholders(token, pathBySheet, referenced)
      );
      const trailingInputs = action.inputSheets
        .filter(sheetName => !referenced.has(sheetName.toLocaleLowerCase()))
        .map(sheetName => pathBySheet.get(sheetName.toLocaleLowerCase()) as string);

      const args = ['--csv', ...commandTokens, ...trailingInputs];

      let stdout: string;
      try {
        ({ stdout } = await execFileAsync('mlr', args, { maxBuffer: MAX_BUFFER }));
      } catch (error: any) {
        const stderr = (error.stderr || '').toString().trim();
        const detail = stderr || error.message;
        throw new Error(`Miller command failed (mlr --csv ${action.command}): ${detail}`);
      }

      // Miller runs in `--csv` mode, so its output is always comma-delimited. Pin the
      // delimiter so single-column output (which has no comma to auto-detect) parses.
      const { headers, data } = CsvProcessor.parseCSV(stdout, ',');
      return {
        name: action.outputSheet,
        fieldNames: headers ?? [],
        data,
      };
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Splits a command string into argv tokens, respecting single and double quotes so
 * Miller DSL expressions such as `filter '$age > 30'` survive as a single argument.
 * Backslash escapes the next character. No shell expansion is performed.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      // Preserve the escaped character literally.
      const next = command[i + 1];
      if (next !== undefined) {
        current += next;
        hasToken = true;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }

  if (quote) {
    throw new Error(`Unterminated ${quote === '"' ? 'double' : 'single'} quote in Miller command: ${command}`);
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

/** Matches a `{{sheetName}}` placeholder; captures the trimmed sheet name. */
const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;

/**
 * Replaces every `{{sheetName}}` placeholder in a single argv token with the input's
 * CSV path (case-insensitive name lookup), recording each referenced sheet in
 * `referenced`. Throws if a placeholder names a sheet that is not a declared input.
 */
export function substitutePlaceholders(
  token: string,
  pathBySheet: Map<string, string>,
  referenced: Set<string>
): string {
  return token.replace(PLACEHOLDER, (_match, rawName: string) => {
    const key = rawName.toLocaleLowerCase();
    const filePath = pathBySheet.get(key);
    if (filePath === undefined) {
      throw new Error(
        `Miller command references unknown input sheet in placeholder {{${rawName}}}; `
        + 'it must name one of the action\'s inputSheets.'
      );
    }
    referenced.add(key);
    return filePath;
  });
}
