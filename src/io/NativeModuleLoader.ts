import type BetterSqlite3 from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Loads the native `better-sqlite3` module, working both when running from source
 * / a normal Node install and when running from a `pkg` single-file executable.
 *
 * Inside a pkg build the module's prebuilt `.node` binary lives in the virtual
 * snapshot filesystem and cannot be `dlopen`'d in place. We therefore extract the
 * matching prebuild to a real temp file once and tell better-sqlite3 to load from
 * there via its `nativeBinding` constructor option (the supported hook in v13 —
 * there is no BETTER_SQLITE3_BINARY env var). Loading is lazy: this is only ever
 * called when an operation actually needs SQLite (merge / lookup), so pipelines
 * without those actions never pay the extraction cost.
 */

type BetterSqlite3Module = typeof import('better-sqlite3');

let cachedModule: BetterSqlite3Module | undefined;
let cachedNativeBinding: string | undefined;
let resolvedNativeBinding = false;

/** The better-sqlite3 constructor. */
export function loadBetterSqlite3(): BetterSqlite3Module {
  if (!cachedModule) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedModule = require('better-sqlite3') as BetterSqlite3Module;
  }
  return cachedModule;
}

/**
 * Opens a better-sqlite3 database, extracting the native binary out of the pkg
 * snapshot first when running as a single-file executable. Callers use this instead
 * of `new Database(...)` directly so the pkg binding path is handled in one place.
 */
export function openDatabase(filename: string): BetterSqlite3.Database {
  const Database = loadBetterSqlite3();
  const nativeBinding = nativeBindingPath();
  return nativeBinding ? new Database(filename, { nativeBinding }) : new Database(filename);
}

// Returns a real filesystem path to the native binding to hand better-sqlite3, or
// undefined to let it resolve its prebuild normally (non-pkg runs). Computed once.
function nativeBindingPath(): string | undefined {
  if (!resolvedNativeBinding) {
    cachedNativeBinding = isPkg() ? ensureExtractedBinary() : undefined;
    resolvedNativeBinding = true;
  }
  return cachedNativeBinding;
}

function isPkg(): boolean {
  return Boolean((process as unknown as { pkg?: unknown }).pkg);
}

// Extracts the platform-appropriate prebuilt binary out of the pkg snapshot into
// os.tmpdir() (hash-stamped so a new build gets a fresh file) and returns the real
// path so it can be passed as better-sqlite3's `nativeBinding`.
function ensureExtractedBinary(): string {
  const sourcePath = resolvePrebuildPath();
  const bytes = fs.readFileSync(sourcePath);
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  const targetDir = path.join(os.tmpdir(), 'sfdata-native');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, `better_sqlite3-${hash}.node`);
  if (!fs.existsSync(targetPath)) {
    // Write atomically so a concurrent run never observes a half-written binary.
    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, bytes);
    fs.renameSync(tmpPath, targetPath);
  }
  return targetPath;
}

// Locates the prebuilt binary inside the (virtual) node_modules for this platform.
// better-sqlite3 ships prebuilds as prebuilds/<platform>-<arch>.node (and a musl
// variant on Alpine).
function resolvePrebuildPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const base = path.join(
    path.dirname(require.resolve('better-sqlite3/package.json')),
    'prebuilds'
  );
  const candidates = [
    `${platform}-${arch}.node`,
    // musl variants (Alpine) — try last so glibc builds win by default.
    `${platform}musl-${arch}.node`,
  ];
  for (const candidate of candidates) {
    const candidatePath = path.join(base, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(
    `No better-sqlite3 prebuilt binary found for ${platform}-${arch} under "${base}".`
  );
}
