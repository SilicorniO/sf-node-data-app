import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const webDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(webDirectory, '..');
const outputDirectory = resolve(rootDirectory, 'dist-web');
const temporaryDirectory = resolve(outputDirectory, '.tmp');
const scriptPath = resolve(temporaryDirectory, 'generator.js');

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(temporaryDirectory, { recursive: true });

await build({
  entryPoints: [resolve(webDirectory, 'src/main.js')],
  bundle: true,
  outfile: scriptPath,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  logLevel: 'info',
});

const script = readFileSync(scriptPath, 'utf8').replace(/<\/script>/gi, '<\\/script>');
const styles = readFileSync(resolve(webDirectory, 'styles/main.css'), 'utf8');
let html = readFileSync(resolve(webDirectory, 'index.html'), 'utf8');

html = html
  .replace(
    '<link rel="stylesheet" href="styles/main.css">',
    () => `<style>${styles}</style>`
  )
  .replace(
    '<script type="module" src="src/main.js"></script>',
    () => `<script>${script}</script>`
  );

const outputPath = resolve(outputDirectory, 'execconf_generator.html');
writeFileSync(outputPath, html, 'utf8');
rmSync(temporaryDirectory, { recursive: true, force: true });

const bytes = Buffer.byteLength(html);
console.log(`Built dist-web/execconf_generator.html (${(bytes / 1024).toFixed(1)} KB)`);
