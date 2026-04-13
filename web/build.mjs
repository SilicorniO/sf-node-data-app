/**
 * Build script — produces two artefacts in dist-web/:
 *
 *   dist-web/execconf_generator.html   Self-contained HTML (config generator + executor)
 *   dist-web/sfdata.js                 Browser-compatible sfdata pipeline library (IIFE)
 *
 * Usage:
 *   npm run build:web
 */

import { build }                               from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname }                    from 'path';
import { fileURLToPath }                       from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');
const outDir    = resolve(root, 'dist-web');
const tmpDir    = resolve(outDir, '.tmp');

mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

// ═══════════════════════════════════════════════════════════════════════════
// 1. sfdata.js — browser-compatible pipeline library (IIFE, global: SfData)
//
//    Built first so we can read it and inline it into the config-generator HTML.
//
//    Node.js-only modules are replaced with browser stubs:
//      • jsforce    → src/browser/jsforce-stub.js  (Connection envelope only)
//      • fs / path  → empty stubs (not reachable from the browser entry point)
// ═══════════════════════════════════════════════════════════════════════════

await build({
  entryPoints: [resolve(root, 'src/browser/index.ts')],
  bundle:      true,
  outfile:     resolve(outDir, 'sfdata.js'),
  format:      'iife',
  globalName:  'SfData',
  target:      ['es2020'],
  minify:      true,
  logLevel:    'info',
  // Replace Node.js-only packages with browser-safe alternatives.
  // Aliasing (instead of marking external) prevents esbuild from emitting
  // require() calls that would throw at runtime in the browser.
  alias: {
    'jsforce':        resolve(root, 'src/browser/jsforce-stub.js'),
    'axios':          resolve(root, 'src/browser/axios-stub.js'),
    // Node.js built-ins aliased to stubs so no require() survives in the bundle
    'fs':             resolve(root, 'src/browser/fs-stub.js'),
    'path':           resolve(root, 'src/browser/path-stub.js'),
    'os':             resolve(root, 'src/browser/empty-stub.js'),
    'crypto':         resolve(root, 'src/browser/empty-stub.js'),
    'stream':         resolve(root, 'src/browser/empty-stub.js'),
    'util':           resolve(root, 'src/browser/empty-stub.js'),
    'events':         resolve(root, 'src/browser/empty-stub.js'),
    'http':           resolve(root, 'src/browser/empty-stub.js'),
    'https':          resolve(root, 'src/browser/empty-stub.js'),
    'net':            resolve(root, 'src/browser/empty-stub.js'),
    'tls':            resolve(root, 'src/browser/empty-stub.js'),
    'zlib':           resolve(root, 'src/browser/empty-stub.js'),
    'buffer':         resolve(root, 'src/browser/empty-stub.js'),
    'child_process':  resolve(root, 'src/browser/empty-stub.js'),
    'worker_threads': resolve(root, 'src/browser/empty-stub.js'),
    'dotenv':         resolve(root, 'src/browser/empty-stub.js'),
  },
});

const sfdataJs  = readFileSync(resolve(outDir, 'sfdata.js'), 'utf8');
const libSizeKb = (Buffer.byteLength(sfdataJs) / 1024).toFixed(1);
console.log(`✓ dist-web/sfdata.js                 (${libSizeKb} KB)`);

// When inlining JS into a <script> block we must:
//  1. Use a function as the replacement so that special $&, $', $` patterns
//     inside the minified code are NOT expanded by String.prototype.replace().
//  2. Escape </script> to prevent the browser from closing the tag early.
//  3. For the sfdata IIFE, explicitly assign window.SfData after the IIFE runs.
//     Although `var x = IIFE` in a top-level non-module script always creates
//     window.x, we add the explicit assignment as a belt-and-suspenders measure
//     to guarantee availability regardless of browser quirks.
function inlineScript(js, { globalName } = {}) {
  const safe   = js.replace(/<\/script>/gi, '<\\/script>');
  const suffix = globalName
    ? `\nif(typeof ${globalName}!=='undefined')window.${globalName}=${globalName};`
    : '';
  return `<script>\n${safe}${suffix}\n  </script>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Config Generator HTML (with sfdata.js inlined)
// ═══════════════════════════════════════════════════════════════════════════

const uiBundleOut = resolve(tmpDir, 'ui-bundle.js');

await build({
  entryPoints: [resolve(__dirname, 'src/main.js')],
  bundle:      true,
  outfile:     uiBundleOut,
  format:      'iife',
  target:      ['es2020'],
  logLevel:    'info',
});

const bundledUiJs = readFileSync(uiBundleOut, 'utf8');
const inlineCss   = readFileSync(resolve(__dirname, 'styles/main.css'), 'utf8');

let html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');

// Reference sfdata.js from the same dist-web/ directory.
// Inlining is avoided: it caused </script>-escaping and $& replacement issues.
// Both files land in dist-web/ so a relative src works when the user opens
// execconf_generator.html directly or serves the dist-web/ folder.
html = html.replace(
  /<script\s[^>]*data-sfdata-lib[^>]*><\/script>/,
  () => `<script src="sfdata.js"></script>`
);

// Inline CSS (no $ risk here, but stay consistent)
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="styles\/main\.css"\s*>/,
  () => `<style>\n${inlineCss}\n  </style>`
);

// Inline main JS bundle
html = html.replace(
  /<script\s+type="module"\s+src="src\/main\.js"><\/script>/,
  () => inlineScript(bundledUiJs)
);

writeFileSync(resolve(outDir, 'execconf_generator.html'), html, 'utf8');
console.log(`✓ dist-web/execconf_generator.html  (${(html.length / 1024).toFixed(1)} KB)`);

// ═══════════════════════════════════════════════════════════════════════════
// 3. Clean up
// ═══════════════════════════════════════════════════════════════════════════

rmSync(tmpDir, { recursive: true, force: true });
console.log('\nBuild complete.\n');
