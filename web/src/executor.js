'use strict';

/**
 * executor.js — Bridge between the web UI and the SfData pipeline library.
 *
 * Exposes:
 *   computeRequiredSheets(conf)  → string[]   - sheets that must be loaded from files
 *   soapLogin(...)               → {accessToken, instanceUrl}
 *   runPipeline(...)             → {sheetsData, error?}
 */

// ── Required-sheets analysis ───────────────────────────────────────────────

/**
 * Determines which sheet names must be supplied by the user (loaded from CSV/Excel)
 * before the pipeline can run.
 *
 * A sheet is required from a file when:
 *  1. It appears as `inputSheet` in any action AND has not already been
 *     produced as the `outputSheet` (≠ inputSheet) of a prior action.
 *  2. It is declared in `conf.sheets` (those always refer to input files).
 *
 * Sheets that are exclusively created/written by a prior action's outputSheet
 * are excluded — the pipeline produces them at runtime.
 *
 * @param {object} conf  Parsed ExecConf (from SfData.parseConf)
 * @returns {string[]}
 */
export function computeRequiredSheets(conf) {
  const producedByExecution = new Set();
  const required            = new Set();

  for (const action of (conf.actions || [])) {
    const inSheet  = action.inputSheet;
    const outSheet = action.outputSheet;

    // If inputSheet is not yet produced by a prior action → must come from a file
    if (inSheet && !producedByExecution.has(inSheet)) {
      required.add(inSheet);
    }

    // This action creates a distinct output sheet that later actions can use
    if (outSheet && outSheet !== inSheet) {
      producedByExecution.add(outSheet);
    }
  }

  // conf.sheets define field-name mappings for input files — always required
  for (const s of (conf.sheets || [])) {
    if (s.name && !producedByExecution.has(s.name)) {
      required.add(s.name);
    }
  }

  return [...required];
}

// ── SOAP Login ─────────────────────────────────────────────────────────────

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Authenticates with Salesforce via the Enterprise SOAP Login API.
 *
 * Note: the target org must have CORS enabled for this page's origin,
 * or this call must be proxied.
 *
 * @param {string} loginUrl  e.g. "https://login.salesforce.com" or "https://test.salesforce.com"
 * @param {string} username
 * @param {string} password  Can include security token appended: "pass+token"
 * @param {string} apiVersion  e.g. "63.0"
 * @returns {Promise<{accessToken: string, instanceUrl: string}>}
 */
export async function soapLogin(loginUrl, username, password, apiVersion = '63.0') {
  const endpoint = `${loginUrl}/services/Soap/c/${apiVersion}`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:urn="urn:enterprise.soap.sforce.com">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:login>
      <urn:username>${escXml(username)}</urn:username>
      <urn:password>${escXml(password)}</urn:password>
    </urn:login>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction':   'login',
    },
    body,
  });

  const text = await res.text();

  if (!res.ok) {
    const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]?.trim()
      || `HTTP ${res.status}`;
    throw new Error(`SOAP Login failed: ${fault}`);
  }

  const sessionId = text.match(/<sessionId>([\s\S]*?)<\/sessionId>/)?.[1]?.trim();
  const serverUrl = text.match(/<serverUrl>([\s\S]*?)<\/serverUrl>/)?.[1]?.trim();

  if (!sessionId || !serverUrl) {
    throw new Error('SOAP response did not contain sessionId or serverUrl.');
  }

  // Extract the org's base URL from the serverUrl
  const instanceUrl = serverUrl.replace(/\/services\/.*$/, '');
  return { accessToken: sessionId, instanceUrl };
}

// ── Pipeline runner ────────────────────────────────────────────────────────

/**
 * Configures auth and runs the sfdata pipeline, capturing all console output.
 *
 * @param {object}   execConf     Parsed ExecConf
 * @param {object}   sheetsData   {[sheetName]: DataSheet}
 * @param {object}   authConfig   See below
 * @param {Function} onLog        (level: 'info'|'warn'|'error', msg: string) => void
 *
 * authConfig shape:
 *   { type: 'connected-app', clientId, clientSecret, instanceUrl }
 *   { type: 'token',         accessToken, instanceUrl }
 *   { type: 'soap',          loginUrl, username, password, instanceUrl? }
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function runPipeline(execConf, sheetsData, authConfig, onLog) {
  const { SalesforceAuthenticator, ActionProcessor } = window.SfData;

  // ── 1. Authenticate ──────────────────────────────────────────────────────
  if (authConfig.type === 'soap') {
    onLog('info', `Authenticating via SOAP Login (${authConfig.loginUrl})…`);
    try {
      const { accessToken, instanceUrl } = await soapLogin(
        authConfig.loginUrl,
        authConfig.username,
        authConfig.password,
        execConf.appConfiguration?.apiVersion || '63.0'
      );
      SalesforceAuthenticator.setBearerTokenParams(accessToken, instanceUrl);
      onLog('info', `SOAP Login successful. Instance URL: ${instanceUrl}`);
    } catch (e) {
      const msg = `SOAP Login error: ${e.message}`;
      onLog('error', msg);
      return { ok: false, error: msg };
    }
  } else if (authConfig.type === 'connected-app') {
    onLog('info', 'Using Connected App (Client Credentials) authentication.');
    SalesforceAuthenticator.setClientCredentialsParams(
      authConfig.clientId,
      authConfig.clientSecret,
      authConfig.instanceUrl
    );
  } else {
    onLog('info', 'Using Bearer Token authentication.');
    SalesforceAuthenticator.setBearerTokenParams(
      authConfig.accessToken,
      authConfig.instanceUrl
    );
  }

  // ── 2. Intercept console output ──────────────────────────────────────────
  const origLog   = console.log;
  const origError = console.error;
  const origWarn  = console.warn;
  const origInfo  = console.info;

  const wrap = (level, orig) => (...args) => {
    orig(...args);
    onLog(level, args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
  };

  console.log   = wrap('info',  origLog);
  console.error = wrap('error', origError);
  console.warn  = wrap('warn',  origWarn);
  console.info  = wrap('info',  origInfo);

  // ── 3. Run ───────────────────────────────────────────────────────────────
  try {
    await ActionProcessor.processActions(execConf, sheetsData);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    console.log   = origLog;
    console.error = origError;
    console.warn  = origWarn;
    console.info  = origInfo;
  }
}
