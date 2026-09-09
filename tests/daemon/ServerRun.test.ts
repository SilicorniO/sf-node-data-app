import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startUiServer } from '../../src/daemon/Server';

// Boots the real daemon in a temp folder and runs the transform-only example, which
// needs no Salesforce auth. Verifies file writing, streamed output, and the result
// trailer. The daemon spawns the built CLI (dist/Index.js), so the project must be
// built (`npm run build`) before running this suite.

const EXAMPLE = path.resolve(__dirname, '../../examples/06-transform-only');
const DIST_CLI = path.resolve(__dirname, '../../dist/Index.js');

let server: http.Server;
let workFolder: string;
let port: number;

const built = fs.existsSync(DIST_CLI);
const suite = built ? describe : describe.skip;

beforeAll(async () => {
  if (!built) return;
  workFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'sfdata-run-'));
  fs.copyFileSync(path.join(EXAMPLE, 'employees.csv'), path.join(workFolder, 'employees.csv'));
  server = startUiServer({ port: 0, cwd: workFolder });
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  port = (server.address() as any).port;
});

afterAll(() => {
  server?.close();
  if (workFolder) fs.rmSync(workFolder, { recursive: true, force: true });
});

/** POSTs /run and collects the full streamed body. */
function postRun(body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      { host: 'localhost', port, path: '/run', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
      }
    );
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

suite('UI daemon run endpoint', () => {
  it('runs a transform-only pipeline and streams the result', async () => {
    const yaml = fs.readFileSync(path.join(EXAMPLE, 'conf.yaml'), 'utf8');
    const script = fs.readFileSync(path.join(EXAMPLE, 'scripts.js'), 'utf8');

    const { status, text } = await postRun({ yaml, script, hasTransform: true, auth: { source: 'env' } });

    expect(status).toBe(200);
    expect(text).toContain('[1/6] Loading configuration');
    expect(text).toContain('Pipeline finished successfully.');

    const trailer = text.split('\n').find(line => line.startsWith('__SFDATA_RESULT__'));
    expect(trailer).toBeDefined();
    const result = JSON.parse(trailer!.replace('__SFDATA_RESULT__', '').trim());
    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.outputs).toContainEqual({ name: 'employees-transformed.csv', rows: 5 });

    expect(fs.existsSync(path.join(workFolder, 'conf.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(workFolder, 'scripts.js'))).toBe(true);
    expect(fs.existsSync(path.join(workFolder, 'output', 'employees-transformed.csv'))).toBe(true);
  });

  it('rejects a run with a missing YAML', async () => {
    const { status } = await postRun({ auth: { source: 'env' } });
    expect(status).toBe(400);
  });

  it('rejects a second run while one is in progress (409)', async () => {
    // A 3s pre-action delay keeps the first run in flight while the second arrives.
    const yaml = [
      'appConfiguration:',
      '  processingType: "bulk"',
      '  apiVersion: "63.0"',
      'actions:',
      '  - name: "T"',
      '    type: "transform"',
      '    inputSheet: "employees"',
      '    outputSheet: "out"',
      '    waitBeforeSeconds: 3',
    ].join('\n');
    const payload = { yaml, script: 'module.exports={T:r=>r};', hasTransform: true, auth: { source: 'env' } };

    const first = postRun(payload);
    await new Promise(resolve => setTimeout(resolve, 500));
    const second = await postRun(payload);
    expect(second.status).toBe(409);

    const firstResult = await first;
    expect(firstResult.status).toBe(200);
  });

  it('serves the daemon status', async () => {
    const status: any = await new Promise((resolve, reject) => {
      http.get({ host: 'localhost', port, path: '/status' }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve(JSON.parse(text)));
      }).on('error', reject);
    });
    expect(status.ok).toBe(true);
    expect(status.cwd).toBe(workFolder);
  });
});
