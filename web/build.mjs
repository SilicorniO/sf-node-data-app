/**
 * Build script: bundles the web project into a single self-contained HTML file.
 *
 * Usage:
 *   npm run build:web
 *
 * Output:
 *   dist-web/execconf_generator.html  (standalone, ready to use)
 */

import { build }                               from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname }                    from 'path';
import { fileURLToPath }                       from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');

// ── 1. Bundle JS with esbuild ─────────────────────────────────────────────────
const outDir = resolve(root, 'dist-web');
mkdirSync(outDir, { recursive: true });

const tmpDir = resolve(outDir, '.tmp');
mkdirSync(tmpDir, { recursive: true });

const bundleOut = resolve(tmpDir, 'bundle.js');

await build({
  entryPoints: [resolve(__dirname, 'src/main.js')],
  bundle:      true,
  outfile:     bundleOut,
  format:      'iife',
  target:      ['es2020'],
  logLevel:    'info',
});

const bundledJs = readFileSync(bundleOut, 'utf8');
const inlineCss = readFileSync(resolve(__dirname, 'styles/main.css'), 'utf8');

// ── 2. Read dev index.html as template ───────────────────────────────────────
let html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');

// ── 3. Replace <link rel="stylesheet"> with inline <style> ───────────────────
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="styles\/main\.css"\s*>/,
  `<style>\n${inlineCss}\n  </style>`
);

// ── 4. Replace <script type="module"> with inline bundled script ──────────────
html = html.replace(
  /<script\s+type="module"\s+src="src\/main\.js"><\/script>/,
  `<script>\n${bundledJs}\n  </script>`
);

// ── 5. Write output ───────────────────────────────────────────────────────────
const outFile = resolve(outDir, 'execconf_generator.html');
writeFileSync(outFile, html, 'utf8');

// ── 6. Clean up temp directory ────────────────────────────────────────────────
rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n✓ Built → dist-web/execconf_generator.html (${(html.length / 1024).toFixed(1)} KB)\n`);
