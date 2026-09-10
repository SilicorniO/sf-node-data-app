// src/daemon/Server.ts
//
// Local UI daemon started with `sfdata --ui`. It serves the offline YAML generator
// and lets the browser run the pipeline in the daemon's working folder: it writes
// conf.yaml (and scripts.js when a transform exists), spawns the pipeline CLI, and
// streams its stdout/stderr back live. Because the daemon serves the page, the page
// is same-origin with these endpoints — no CORS handling required.
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { listOrgs, resolveOrgToken, SfTokenError } from './SfOrgs';

const DEFAULT_PORT = 3111;
const CONF_FILE = 'conf.yaml';
const SCRIPT_FILE = 'scripts.js';
const INPUT_FOLDER = './input';
const OUTPUT_FOLDER = './output';
const RESULT_MARKER = '__SFDATA_RESULT__';

export interface StartUiServerOptions {
  port?: number;
  cwd?: string;
}

export interface RunRequest {
  yaml?: string;
  script?: string;
  hasTransform?: boolean;
  auth?: {
    source?: 'env' | 'sf' | 'paste';
    org?: string;
    instanceUrl?: string;
    accessToken?: string;
  };
  fromTask?: string | number;
  toTask?: string | number;
}

/** Resolves the built generator HTML path, preferring the repo's dist-web output. */
function resolveGeneratorHtml(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../dist-web/execconf_generator.html'),
    path.resolve(process.cwd(), 'dist-web/execconf_generator.html'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

/** Reads the request body as JSON, rejecting on invalid input or excessive size. */
function readJsonBody(request: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const limit = 64 * 1024 * 1024; // configs + scripts are small; guard against runaway bodies
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error: any) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(body);
}

/** Detects a usable credential in a .env file (bearer or client-credentials). */
export function detectEnvCredential(cwd: string): 'bearer' | 'clientCredentials' | null {
  const envPath = path.join(cwd, '.env');
  let text: string;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return null;
  }
  const has = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(text);
  if (has('SF_ACCESS_TOKEN') && has('SF_INSTANCE_URL')) return 'bearer';
  if (has('SF_CLIENT_ID') && has('SF_CLIENT_SECRET') && has('SF_INSTANCE_URL')) {
    return 'clientCredentials';
  }
  return null;
}

/** Locates the pipeline CLI entry to spawn (built dist first, TS source in dev). */
function resolveCliInvocation(): { command: string; baseArgs: string[] } {
  // In the built daemon (dist/daemon/Server.js) the sibling is dist/Index.js.
  // Under ts-node/vitest, __dirname is the source location, so also try the
  // repo-root dist and the process cwd.
  const distCandidates = [
    path.resolve(__dirname, '../Index.js'),
    path.resolve(__dirname, '../../dist/Index.js'),
    path.resolve(process.cwd(), 'dist/Index.js'),
  ];
  const distIndex = distCandidates.find(candidate => fs.existsSync(candidate));
  if (distIndex) {
    return { command: process.execPath, baseArgs: [distIndex] };
  }
  const tsIndex = path.resolve(__dirname, '../Index.ts');
  return { command: process.execPath, baseArgs: ['-r', 'ts-node/register', tsIndex] };
}

export function startUiServer(options: StartUiServerOptions = {}): http.Server {
  const port = options.port ?? DEFAULT_PORT;
  const cwd = options.cwd ?? process.cwd();
  let running = false;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', `http://localhost:${port}`);
    const route = url.pathname;

    if (request.method === 'GET' && (route === '/' || route === '/index.html')) {
      serveGenerator(response);
      return;
    }
    if (request.method === 'GET' && route === '/status') {
      sendJson(response, 200, { ok: true, cwd, port, running });
      return;
    }
    if (request.method === 'GET' && route === '/auth') {
      handleAuth(cwd, response);
      return;
    }
    if (request.method === 'GET' && route === '/config') {
      handleConfig(cwd, response);
      return;
    }
    if (request.method === 'POST' && route === '/config') {
      handleSaveConfig(cwd, request, response);
      return;
    }
    if (request.method === 'POST' && route === '/run') {
      if (running) {
        sendJson(response, 409, { error: 'A pipeline run is already in progress.' });
        return;
      }
      running = true;
      handleRun(cwd, request, response).finally(() => {
        running = false;
      });
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
  });

  server.listen(port, () => {
    console.log(`sf-data UI daemon running at http://localhost:${port}`);
    console.log(`Working folder: ${cwd}`);
    console.log('Open the URL above in your browser, then use Run to execute the pipeline here.');
  });
  return server;
}

function serveGenerator(response: http.ServerResponse): void {
  const htmlPath = resolveGeneratorHtml();
  if (!htmlPath) {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Generator not built. Run "npm run build:web" first.');
    return;
  }
  const html = fs.readFileSync(htmlPath);
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

/**
 * Returns any conf.yaml (and scripts.js) already present in the daemon's folder so
 * the generator can preload the on-disk configuration. Reuses the fixed filename
 * conventions the run endpoint writes.
 */
function handleConfig(cwd: string, response: http.ServerResponse): void {
  sendJson(response, 200, readFolderConfig(cwd));
}

/** Reads conf.yaml / scripts.js from a folder, returning nulls when absent. */
export function readFolderConfig(cwd: string): {
  hasConf: boolean;
  yaml: string | null;
  script: string | null;
} {
  const readIfPresent = (fileName: string): string | null => {
    try {
      return fs.readFileSync(path.join(cwd, fileName), 'utf8');
    } catch {
      return null;
    }
  };
  const yaml = readIfPresent(CONF_FILE);
  const script = readIfPresent(SCRIPT_FILE);
  return { hasConf: yaml !== null, yaml, script };
}

/**
 * Writes conf.yaml (and scripts.js only when the pipeline has a transform action) to
 * the daemon's folder. Single writer shared by the save endpoint and the run endpoint,
 * so a saved-then-run configuration is byte-identical to a run-written one.
 */
export function writeFolderConfig(
  cwd: string,
  config: { yaml: string; script?: string; hasTransform?: boolean }
): void {
  fs.writeFileSync(path.join(cwd, CONF_FILE), config.yaml, 'utf8');
  if (config.hasTransform) {
    fs.writeFileSync(path.join(cwd, SCRIPT_FILE), config.script ?? '', 'utf8');
  }
}

/** Persists conf.yaml (and scripts.js) to the daemon folder without running the pipeline. */
async function handleSaveConfig(
  cwd: string,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  let body: RunRequest;
  try {
    body = await readJsonBody(request);
  } catch (error: any) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  if (!body.yaml || !body.yaml.trim()) {
    sendJson(response, 400, { error: 'Missing YAML configuration.' });
    return;
  }
  try {
    writeFolderConfig(cwd, { yaml: body.yaml, script: body.script, hasTransform: body.hasTransform });
  } catch (error: any) {
    sendJson(response, 500, { error: `Could not write configuration files: ${error.message}` });
    return;
  }
  sendJson(response, 200, { ok: true });
}

async function handleAuth(cwd: string, response: http.ServerResponse): Promise<void> {
  const envCredential = detectEnvCredential(cwd);
  const { sfAvailable, orgs } = await listOrgs();
  const recommendedSource = envCredential ? 'env' : orgs.length ? 'sf' : 'paste';
  sendJson(response, 200, { envCredential, sfAvailable, orgs, recommendedSource });
}

async function handleRun(
  cwd: string,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  let body: RunRequest;
  try {
    body = await readJsonBody(request);
  } catch (error: any) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  if (!body.yaml || !body.yaml.trim()) {
    sendJson(response, 400, { error: 'Missing YAML configuration.' });
    return;
  }

  // Resolve authentication before touching disk so an auth failure aborts cleanly.
  let env: NodeJS.ProcessEnv = { ...process.env };
  const source = body.auth?.source ?? 'env';
  try {
    if (source === 'sf') {
      if (!body.auth?.org) throw new Error('No Salesforce org selected.');
      const token = await resolveOrgToken(body.auth.org);
      env.SF_ACCESS_TOKEN = token.accessToken;
      env.SF_INSTANCE_URL = token.instanceUrl;
    } else if (source === 'paste') {
      if (!body.auth?.accessToken || !body.auth?.instanceUrl) {
        throw new Error('Both an access token and instance URL are required.');
      }
      env.SF_ACCESS_TOKEN = body.auth.accessToken;
      env.SF_INSTANCE_URL = body.auth.instanceUrl;
    }
    // source === 'env': leave process env / .env resolution to the CLI itself.
  } catch (error: any) {
    const status = error instanceof SfTokenError ? 409 : 400;
    sendJson(response, status, { error: error.message, needsToken: error instanceof SfTokenError });
    return;
  }

  // Write conf.yaml, and scripts.js only when the pipeline has a transform action.
  // Ensure the input folder exists so a pipeline with no input files (e.g. starting
  // with a get action) does not fail when the CLI scans a missing "./input" folder.
  try {
    writeFolderConfig(cwd, { yaml: body.yaml, script: body.script, hasTransform: body.hasTransform });
    fs.mkdirSync(path.join(cwd, INPUT_FOLDER), { recursive: true });
  } catch (error: any) {
    sendJson(response, 500, { error: `Could not write configuration files: ${error.message}` });
    return;
  }

  // Stream the CLI output as a chunked text/plain body the browser reads line by line.
  response.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  const args = buildCliArgs(body);
  const { command, baseArgs } = resolveCliInvocation();
  const child = spawn(command, [...baseArgs, ...args], { cwd, env });

  const outputs: Array<{ name: string; rows: number }> = [];
  let carry = '';
  const onChunk = (chunk: Buffer) => {
    const text = carry + chunk.toString('utf8');
    const lines = text.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) {
      captureOutput(line, outputs);
      response.write(line + '\n');
    }
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  // Resolve only when the child exits, so the caller's single-run guard stays held
  // for the whole run rather than releasing as soon as the listeners are attached.
  await new Promise<void>(resolve => {
    let settled = false;
    const settle = (exitCode: number, startupError?: string) => {
      if (settled) return;
      settled = true;
      if (startupError) response.write(`\nFailed to start pipeline: ${startupError}\n`);
      finishRun(response, carry, outputs, exitCode);
      resolve();
    };
    child.on('error', error => settle(1, error.message));
    child.on('close', code => settle(code ?? 1));
  });
}

/** Emits any buffered final line and the machine-readable result trailer, then ends. */
function finishRun(
  response: http.ServerResponse,
  carry: string,
  outputs: Array<{ name: string; rows: number }>,
  exitCode: number
): void {
  if (carry) {
    captureOutput(carry, outputs);
    response.write(carry + '\n');
  }
  const status = exitCode === 0 ? 'success' : 'failed';
  response.write(`${RESULT_MARKER} ${JSON.stringify({ exitCode, status, outputs })}\n`);
  response.end();
}

/** Parses the CLI's `+ <sheet>.csv: <n> row(s)` lines into the output-file list. */
export function captureOutput(line: string, outputs: Array<{ name: string; rows: number }>): void {
  const match = line.match(/^\s*\+\s+(.+\.csv):\s+(\d+)\s+row/);
  if (match) {
    outputs.push({ name: match[1], rows: Number(match[2]) });
  }
}

export function buildCliArgs(body: RunRequest): string[] {
  const args = [
    '--confFile', CONF_FILE,
    '--inputFolder', INPUT_FOLDER,
    '--outputFolder', OUTPUT_FOLDER,
  ];
  if (body.hasTransform) {
    args.push('--scriptFile', SCRIPT_FILE);
  }
  if (body.fromTask !== undefined && body.fromTask !== '') {
    args.push('--fromTask', String(body.fromTask));
  }
  if (body.toTask !== undefined && body.toTask !== '') {
    args.push('--toTask', String(body.toTask));
  }
  return args;
}
