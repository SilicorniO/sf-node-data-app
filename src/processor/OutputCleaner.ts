import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OutputCleanupResult {
  mode: 'none' | 'all' | 'errors';
  deletedFiles: number;
}

export class OutputCleaner {
  static clean(
    outputFolder: string,
    cleanAll: boolean,
    deleteErrors: boolean,
    errorSheetNames: string[],
    protectedFiles: string[] = []
  ): OutputCleanupResult {
    if (!cleanAll && !deleteErrors) return { mode: 'none', deletedFiles: 0 };

    const resolved = path.resolve(outputFolder);
    if (cleanAll) {
      this.assertSafeFullCleanupTarget(resolved);
      this.assertNoProtectedFiles(resolved, protectedFiles);
    }
    if (!fs.existsSync(resolved)) {
      return { mode: cleanAll ? 'all' : 'errors', deletedFiles: 0 };
    }

    if (cleanAll) {
      const deletedFiles = this.countFiles(resolved);
      for (const entry of fs.readdirSync(resolved)) {
        fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
      }
      return { mode: 'all', deletedFiles };
    }

    const configuredErrorFiles = new Set(
      errorSheetNames.map(name => `${name}.csv`.toLocaleLowerCase())
    );
    let deletedFiles = 0;
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      const normalizedName = entry.name.toLocaleLowerCase();
      if (
        entry.isFile()
        && (normalizedName.endsWith('-errors.csv') || configuredErrorFiles.has(normalizedName))
      ) {
        fs.rmSync(path.join(resolved, entry.name), { force: true });
        deletedFiles++;
      }
    }
    return { mode: 'errors', deletedFiles };
  }

  private static assertSafeFullCleanupTarget(outputFolder: string): void {
    const actualTarget = fs.existsSync(outputFolder) ? fs.realpathSync(outputFolder) : outputFolder;
    const root = path.parse(actualTarget).root;
    const home = fs.realpathSync(os.homedir());
    const cwd = fs.realpathSync(process.cwd());
    if (
      actualTarget === root
      || actualTarget === home
      || actualTarget === cwd
      || cwd.startsWith(`${actualTarget}${path.sep}`)
    ) {
      throw new Error(
        `Refusing to clean unsafe output folder "${outputFolder}". Choose a dedicated output subfolder.`
      );
    }
  }

  private static assertNoProtectedFiles(outputFolder: string, protectedFiles: string[]): void {
    const actualTarget = fs.existsSync(outputFolder) ? fs.realpathSync(outputFolder) : outputFolder;
    for (const file of protectedFiles) {
      const resolvedFile = path.resolve(file);
      const actualFile = fs.existsSync(resolvedFile) ? fs.realpathSync(resolvedFile) : resolvedFile;
      if (actualFile === actualTarget || actualFile.startsWith(`${actualTarget}${path.sep}`)) {
        throw new Error(
          `Refusing to clean output folder "${outputFolder}" because it contains input or configuration file "${file}".`
        );
      }
    }
  }

  private static countFiles(folder: string): number {
    return fs.readdirSync(folder, { withFileTypes: true }).reduce((total, entry) => {
      const entryPath = path.join(folder, entry.name);
      return total + (entry.isDirectory() ? this.countFiles(entryPath) : 1);
    }, 0);
  }
}
