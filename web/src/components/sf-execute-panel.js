'use strict';

import { bus }                    from '../state.js';
import { genYaml }                from '../yaml.js';
import { computeRequiredSheets, runPipeline } from '../executor.js';

const LS_AUTH_KEY = 'sfdata_auth_config';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(d) {
  return d.toTimeString().slice(0, 8);
}

/**
 * Converts a Salesforce Lightning Experience URL to the My Domain REST API URL.
 *   *.lightning.force.com  →  *.my.salesforce.com
 * Salesforce's REST API only responds at the My Domain URL; using the Lightning
 * URL causes a redirect on the preflight request, which browsers reject.
 */
function normalizeInstanceUrl(url) {
  return (url || '').trim().replace(/\.lightning\.force\.com\/?$/, '.my.salesforce.com');
}

/** Returns true when the page is served as a file:// URL (origin = "null"). */
function isFileProtocol() {
  return location.protocol === 'file:';
}

function nameFromFile(f) {
  return f.name.replace(/\.[^.]+$/, '');
}

function sheetFromCsv(csvString, sheetName) {
  return window.SfData.parseCsv(csvString, sheetName);
}

function sheetsFromExcel(arrayBuffer) {
  return window.SfData.parseExcel(arrayBuffer);
}

// ── Component ──────────────────────────────────────────────────────────────

class SfExecutePanel extends HTMLElement {

  constructor() {
    super();
    this._step         = 'sheets';   // 'sheets' | 'configure' | 'log'
    this._execConf     = null;       // ExecConf parsed from current YAML
    this._required     = [];         // string[] — sheet names needed from files
    this._loaded       = {};         // { [name]: DataSheet }
    this._logs         = [];         // { level, time, msg }[]
    this._running      = false;
    this._done         = false;
    this._runOk        = null;       // true | false | null
    this._auth         = this._loadAuth();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  connectedCallback() {
    this.innerHTML = `<section id="tab-execute" class="tab-section"></section>`;

    bus.on('tab-switch', name => {
      this.querySelector('section').classList.toggle('active', name === 'execute');
      if (name === 'execute') this._activate();
    });
  }

  // ── Step management ──────────────────────────────────────────────────────

  _activate() {
    this._parseConf();
    this._renderStep();
  }

  _parseConf() {
    try {
      const yaml = genYaml();
      this._execConf = window.SfData.parseConf(yaml);
      this._required = computeRequiredSheets(this._execConf);
    } catch (e) {
      this._execConf = null;
      this._required = [];
    }
  }

  _go(step) {
    this._step = step;
    this._renderStep();
  }

  _renderStep() {
    const sec = this.querySelector('section');
    if (!sec) return;

    if (!window.SfData) {
      sec.innerHTML = `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          <p class="font-semibold text-red-600 mb-1">SfData library not loaded.</p>
          <p class="text-xs">Run <code class="bg-slate-100 px-1 rounded">npm run build:web</code> to generate it, then open the built <code class="bg-slate-100 px-1 rounded">dist-web/execconf_generator.html</code>.</p>
        </div>`;
      return;
    }

    if (this._step === 'sheets')    { sec.innerHTML = this._htmlSheets();    this._bindSheets();    return; }
    if (this._step === 'configure') { sec.innerHTML = this._htmlConfigure(); this._bindConfigure(); return; }
    if (this._step === 'log')       { sec.innerHTML = this._htmlLog();       this._bindLog();       return; }
  }

  // ── Step 1 — Load Sheets ─────────────────────────────────────────────────

  _htmlSheets() {
    if (!this._execConf || (!this._required.length && !this._execConf.actions?.length)) {
      return `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          <p class="text-2xl mb-3">📋</p>
          <p class="font-semibold text-slate-600 mb-1">No configuration loaded.</p>
          <p class="text-xs">Build a pipeline in the <strong>App Config</strong>, <strong>Sheets</strong>, and <strong>Actions</strong> tabs first.</p>
        </div>`;
    }

    const allLoaded   = this._required.every(n => this._loaded[n]);
    const loadedCount = this._required.filter(n => this._loaded[n]).length;
    const total       = this._required.length;

    const rows = this._required.length
      ? this._required.map(name => {
          const sheet = this._loaded[name];
          return `
            <div class="sheet-loader-row flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
              <div class="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold
                          ${sheet ? 'bg-emerald-100 text-emerald-600' : 'bg-red-50 text-red-400'}">
                ${sheet ? '✓' : '✗'}
              </div>
              <div class="flex-1 min-w-0">
                <span class="font-mono text-sm font-semibold text-slate-700">${name}</span>
                ${sheet
                  ? `<span class="ml-2 text-[11px] text-slate-400">${sheet.fieldNames.length} columns · ${sheet.data.length} rows</span>`
                  : `<span class="ml-2 text-[11px] text-red-400">Not loaded yet</span>`
                }
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                ${sheet
                  ? `<button data-remove="${name}" class="text-[11px] text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition">Remove</button>`
                  : `<label class="btn-secondary text-xs py-1 px-3 cursor-pointer">
                       Upload CSV
                       <input type="file" accept=".csv" data-sheet="${name}" class="hidden sheet-csv-input">
                     </label>`
                }
              </div>
            </div>`;
        }).join('')
      : `<div class="px-4 py-6 text-center text-slate-400 text-xs">No sheets needed from files — the pipeline generates all data from Salesforce exports.</div>`;

    return `
      <div class="space-y-4">
        <!-- Header -->
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <h2 class="font-bold text-slate-800 text-sm">Load Input Sheets</h2>
              <p class="text-[11px] text-slate-400 mt-0.5">Upload the files required by your pipeline configuration.</p>
            </div>
            <div class="flex items-center gap-3">
              ${total > 0 ? `
              <span class="text-xs font-semibold ${allLoaded ? 'text-emerald-600' : 'text-amber-600'}">
                ${loadedCount} / ${total} loaded
              </span>` : ''}
              <label class="btn-secondary text-xs py-1.5 px-3 cursor-pointer">
                📊 Load Excel
                <input type="file" id="excel-global-input" accept=".xlsx,.xls" class="hidden">
              </label>
            </div>
          </div>
          <div id="sheets-loader-list">${rows}</div>
        </div>

        <!-- Info about produced sheets -->
        ${this._producedSheetsInfo()}

        <!-- Next button -->
        <div class="flex justify-end">
          <button id="btn-next-configure"
            class="btn-primary px-6 py-2 ${allLoaded ? '' : 'opacity-40 cursor-not-allowed'}"
            ${allLoaded ? '' : 'disabled'}>
            Configure & Run ▶
          </button>
        </div>
      </div>`;
  }

  _producedSheetsInfo() {
    if (!this._execConf) return '';
    const produced = [];
    const seen = new Set();
    for (const a of (this._execConf.actions || [])) {
      if (a.outputSheet && a.outputSheet !== a.inputSheet && !seen.has(a.outputSheet)) {
        produced.push(a.outputSheet);
        seen.add(a.outputSheet);
      }
    }
    if (!produced.length) return '';
    return `
      <div class="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[11px] text-slate-500">
        <span class="font-semibold text-slate-600">Generated by pipeline:</span>
        ${produced.map(n => `<span class="ml-1.5 font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded">${n}</span>`).join('')}
        <span class="ml-1">— these sheets are created during execution, no upload needed.</span>
      </div>`;
  }

  _bindSheets() {
    // CSV upload per sheet
    this.querySelectorAll('.sheet-csv-input').forEach(inp => {
      inp.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const name = inp.dataset.sheet;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            this._loaded[name] = sheetFromCsv(ev.target.result, name);
            this._renderStep();
          } catch (err) {
            alert(`Error parsing CSV for "${name}": ${err.message}`);
          }
        };
        reader.readAsText(file);
      });
    });

    // Excel global upload
    const excelInp = this.querySelector('#excel-global-input');
    if (excelInp) {
      excelInp.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const sheets = sheetsFromExcel(ev.target.result);
            Object.assign(this._loaded, sheets);
            this._renderStep();
          } catch (err) {
            alert(`Error parsing Excel: ${err.message}`);
          }
        };
        reader.readAsArrayBuffer(file);
      });
    }

    // Remove sheet
    this.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        delete this._loaded[btn.dataset.remove];
        this._renderStep();
      });
    });

    // Next
    const nextBtn = this.querySelector('#btn-next-configure');
    if (nextBtn && !nextBtn.disabled) {
      nextBtn.addEventListener('click', () => this._go('configure'));
    }
  }

  // ── Step 2 — Configure & Run ─────────────────────────────────────────────

  _htmlConfigure() {
    const a = this._auth;
    const sel = (type) => a.type === type ? 'checked' : '';
    const val = (k, fb = '') => a[k] || fb;

    const urlWarning = this._instanceUrlWarning(a.instanceUrl);

    return `
      <div class="space-y-4">

        ${isFileProtocol() ? `
        <!-- file:// CORS warning -->
        <div class="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs text-amber-800">
          <span class="text-lg leading-none mt-0.5">⚠️</span>
          <div>
            <p class="font-bold mb-1">CORS restriction — open via a local server</p>
            <p>Browsers block cross-origin requests from <code class="bg-amber-100 px-1 rounded">file://</code> pages.
            Salesforce will reject calls with <em>origin: null</em>.</p>
            <p class="mt-1">Serve the <code class="bg-amber-100 px-1 rounded">dist-web/</code> folder locally instead:</p>
            <pre class="bg-amber-100 rounded px-2 py-1 mt-1 font-mono text-[11px] whitespace-pre-wrap">npx serve dist-web -l 3002</pre>
            <p class="mt-1">Then open <code class="bg-amber-100 px-1 rounded">http://localhost:3002/execconf_generator.html</code>
            and add <code class="bg-amber-100 px-1 rounded">http://localhost:3002</code> to your Salesforce org's
            <strong>CORS Allowed Origins</strong> list (Setup → CORS).</p>
          </div>
        </div>` : ''}

        <!-- Auth card -->
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h2 class="font-bold text-slate-800 text-sm">Salesforce Connection</h2>
            <p class="text-[11px] text-slate-400 mt-0.5">Choose how to authenticate with your org.</p>
          </div>
          <div class="p-4 space-y-4">

            <!-- Auth type selector -->
            <div class="flex flex-wrap gap-3">
              ${[
                ['connected-app', '🔑 Connected App',  'Client ID + Secret (Client Credentials flow)'],
                ['token',         '🪙 Bearer Token',   'Pre-obtained access token or session ID'],
                ['soap',          '🔐 SOAP Login',     'Username + Password (Enterprise SOAP API)'],
              ].map(([type, label, desc]) => `
                <label class="auth-radio-label flex items-start gap-2.5 flex-1 min-w-[200px] border rounded-xl p-3 cursor-pointer transition
                              ${a.type === type ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}">
                  <input type="radio" name="auth-type" value="${type}" ${sel(type)} class="mt-0.5 accent-indigo-600">
                  <div>
                    <div class="text-xs font-bold text-slate-700">${label}</div>
                    <div class="text-[10px] text-slate-400 mt-0.5">${desc}</div>
                  </div>
                </label>`).join('')}
            </div>

            <!-- Fields: Connected App -->
            <div id="fields-connected-app" class="grid grid-cols-1 sm:grid-cols-2 gap-3 ${a.type !== 'connected-app' ? 'hidden' : ''}">
              <div>
                <label class="field-label">Consumer Key (Client ID)</label>
                <input id="auth-clientId" type="text" class="field-input font-mono text-xs" value="${val('clientId')}" placeholder="3MVG9…">
              </div>
              <div>
                <label class="field-label">Consumer Secret</label>
                <input id="auth-clientSecret" type="password" class="field-input font-mono text-xs" value="${val('clientSecret')}" placeholder="••••••••">
              </div>
            </div>

            <!-- Fields: Bearer Token -->
            <div id="fields-token" class="${a.type !== 'token' ? 'hidden' : ''}">
              <label class="field-label">Access Token / Session ID</label>
              <input id="auth-accessToken" type="password" class="field-input font-mono text-xs" value="${val('accessToken')}" placeholder="00D…">
            </div>

            <!-- Fields: SOAP Login -->
            <div id="fields-soap" class="grid grid-cols-1 sm:grid-cols-3 gap-3 ${a.type !== 'soap' ? 'hidden' : ''}">
              <div class="sm:col-span-1">
                <label class="field-label">Login URL</label>
                <input id="auth-loginUrl" type="text" class="field-input" value="${val('loginUrl', 'https://test.salesforce.com')}" placeholder="https://test.salesforce.com">
              </div>
              <div>
                <label class="field-label">Username</label>
                <input id="auth-username" type="text" class="field-input" value="${val('username')}" placeholder="user@example.com">
              </div>
              <div>
                <label class="field-label">Password + Security Token</label>
                <input id="auth-password" type="password" class="field-input" value="${val('password')}" placeholder="mypass+token">
              </div>
            </div>

            <!-- Instance URL (always shown for non-SOAP) -->
            <div id="field-instanceUrl" class="${a.type === 'soap' ? 'hidden' : ''}">
              <label class="field-label">Instance URL</label>
              <input id="auth-instanceUrl" type="text" class="field-input" value="${val('instanceUrl')}"
                     placeholder="https://your-org.my.salesforce.com">
              <p class="text-[10px] text-slate-400 mt-1">Must be your <strong>My Domain</strong> URL ending in <code class="bg-slate-100 px-1 rounded">.my.salesforce.com</code> — not the Lightning UI URL.</p>
              ${urlWarning}
            </div>

          </div>
        </div>

        <!-- Sheets summary -->
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h2 class="font-bold text-slate-800 text-sm">Loaded Sheets</h2>
            <span class="text-[11px] text-slate-400">${Object.keys(this._loaded).length} sheet${Object.keys(this._loaded).length !== 1 ? 's' : ''}</span>
          </div>
          <div class="px-4 py-2 flex flex-wrap gap-2">
            ${Object.entries(this._loaded).map(([n, s]) =>
              `<span class="bg-slate-100 text-slate-700 font-mono text-[11px] px-2 py-1 rounded">
                 ${n} <span class="text-slate-400">(${s.data.length} rows)</span>
               </span>`
            ).join('') || '<span class="text-slate-400 text-xs py-1">No sheets loaded.</span>'}
          </div>
        </div>

        <!-- Action row -->
        <div class="flex items-center justify-between">
          <button id="btn-back-sheets" class="btn-secondary px-5 py-2">← Back</button>
          <button id="btn-run" class="btn-primary px-8 py-2.5 text-sm font-bold">▶ Run Pipeline</button>
        </div>
      </div>`;
  }

  _bindConfigure() {
    // Auth type radios
    this.querySelectorAll('input[name="auth-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        this._auth.type = radio.value;
        this._saveAuth();
        this._renderStep();
      });
    });

    // Highlight selected auth card
    this.querySelectorAll('.auth-radio-label').forEach(lbl => {
      lbl.querySelector('input')?.addEventListener('change', () => {
        this.querySelectorAll('.auth-radio-label').forEach(l => {
          const checked = l.querySelector('input')?.checked;
          l.classList.toggle('border-indigo-400', checked);
          l.classList.toggle('bg-indigo-50', checked);
          l.classList.toggle('border-slate-200', !checked);
        });
      });
    });

    // Sync auth fields on input
    const sync = (id, key) => {
      const el = this.querySelector(id);
      if (el) el.addEventListener('input', () => { this._auth[key] = el.value; this._saveAuth(); });
    };
    sync('#auth-clientId',      'clientId');
    sync('#auth-clientSecret',  'clientSecret');
    sync('#auth-accessToken',   'accessToken');
    sync('#auth-loginUrl',      'loginUrl');
    sync('#auth-username',      'username');
    sync('#auth-password',      'password');

    // Instance URL: sync + re-render warning on change
    const urlEl = this.querySelector('#auth-instanceUrl');
    if (urlEl) {
      urlEl.addEventListener('input', () => {
        this._auth.instanceUrl = urlEl.value;
        this._saveAuth();
        // Refresh warning area without full re-render
        const warnArea = this.querySelector('#field-instanceUrl p + div, #field-instanceUrl > div[class*="amber"]');
        const fieldDiv = this.querySelector('#field-instanceUrl');
        if (fieldDiv) {
          const existingWarn = fieldDiv.querySelector('div[class*="amber"]');
          if (existingWarn) existingWarn.remove();
          const tmp = document.createElement('div');
          tmp.innerHTML = this._instanceUrlWarning(urlEl.value);
          if (tmp.firstElementChild) {
            fieldDiv.appendChild(tmp.firstElementChild);
            this._bindFixUrlBtn();
          }
        }
      });
    }
    this._bindFixUrlBtn();

    // Back
    this.querySelector('#btn-back-sheets')?.addEventListener('click', () => this._go('sheets'));
  }

  _bindFixUrlBtn() {
    this.querySelector('#btn-fix-url')?.addEventListener('click', () => {
      const corrected = normalizeInstanceUrl(this._auth.instanceUrl);
      this._auth.instanceUrl = corrected;
      this._saveAuth();
      this._renderStep(); // full re-render to update the input value and clear the warning
    });

    // Run
    this.querySelector('#btn-run')?.addEventListener('click', () => this._startRun());
  }

  // ── Step 3 — Execution Log ───────────────────────────────────────────────

  _htmlLog() {
    const statusBadge = this._running
      ? `<span class="exec-status-running px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">⏳ Running…</span>`
      : this._runOk === true
        ? `<span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">✓ Completed</span>`
        : this._runOk === false
          ? `<span class="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">✗ Failed</span>`
          : '';

    const logHtml = this._logs.map(l => {
      const cls = l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-green-300';
      return `<div class="${cls}"><span class="text-slate-500 select-none">[${l.time}] </span>${escHtml(l.msg)}</div>`;
    }).join('');

    const downloads = !this._running && Object.keys(this._loaded).length
      ? `<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
           <div class="px-4 py-3 border-b border-slate-100 bg-slate-50">
             <h3 class="font-bold text-slate-800 text-sm">Download Results</h3>
           </div>
           <div class="px-4 py-3 flex flex-wrap gap-2">
             ${Object.entries(this._loaded).map(([name, sheet]) =>
               `<button data-dl="${name}" class="btn-secondary text-xs py-1.5 px-3">⬇ ${name}.csv</button>`
             ).join('')}
           </div>
         </div>`
      : '';

    return `
      <div class="space-y-4">
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h2 class="font-bold text-slate-800 text-sm">Execution Log</h2>
            <div class="flex items-center gap-2">
              ${statusBadge}
              ${!this._running ? `<button id="btn-restart" class="btn-secondary text-xs py-1.5 px-3">← Start Over</button>` : ''}
            </div>
          </div>
          <div id="exec-log" class="exec-log-panel">${logHtml || '<span class="text-slate-600">Starting…</span>'}</div>
        </div>
        ${downloads}
      </div>`;
  }

  _bindLog() {
    this.querySelector('#btn-restart')?.addEventListener('click', () => {
      this._step     = 'sheets';
      this._logs     = [];
      this._running  = false;
      this._done     = false;
      this._runOk    = null;
      this._renderStep();
    });

    this.querySelectorAll('[data-dl]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name  = btn.dataset.dl;
        const sheet = this._loaded[name];
        if (!sheet) return;
        const csv  = window.SfData.toCsv(sheet);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${name}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }

  // ── Execution ────────────────────────────────────────────────────────────

  async _startRun() {
    // Snapshot current auth values from inputs
    this._syncAuthFromInputs();
    this._saveAuth();

    if (!this._execConf) {
      alert('No valid configuration. Go back to the Config Builder.');
      return;
    }

    this._logs    = [];
    this._running = true;
    this._runOk   = null;
    this._go('log');

    const onLog = (level, msg) => {
      this._logs.push({ level, time: fmt(new Date()), msg });
      this._appendLogLine(level, msg);
    };

    // Deep-clone loaded sheets so the library can mutate them freely
    const sheetsData = Object.fromEntries(
      Object.entries(this._loaded).map(([k, v]) => [k, {
        name: v.name,
        fieldNames: [...v.fieldNames],
        data: v.data.map(r => [...r]),
      }])
    );

    const { ok, error } = await runPipeline(
      this._execConf,
      sheetsData,
      this._auth,
      onLog
    );

    // Merge mutated sheets back
    Object.assign(this._loaded, sheetsData);

    this._running = false;
    this._runOk   = ok;

    if (!ok) onLog('error', `Pipeline ended with errors: ${error || ''}`);
    else      onLog('info',  'Pipeline completed successfully.');

    // Re-render to show final status + download buttons
    this._go('log');
  }

  _appendLogLine(level, msg) {
    const log = this.querySelector('#exec-log');
    if (!log) return;
    const cls = level === 'error' ? 'text-red-400' : level === 'warn' ? 'text-amber-400' : 'text-green-300';
    const div = document.createElement('div');
    div.className = cls;
    div.innerHTML = `<span class="text-slate-500 select-none">[${fmt(new Date())}] </span>${escHtml(msg)}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;

    // Update status badge in real time
    const badge = this.querySelector('.exec-status-running');
    if (badge) badge.textContent = '⏳ Running…';
  }

  // ── URL helpers ───────────────────────────────────────────────────────────

  _instanceUrlWarning(url) {
    if (!url) return '';
    const normalized = normalizeInstanceUrl(url);
    if (normalized !== url.trim()) {
      return `
        <div class="mt-1.5 flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-[11px] text-amber-800">
          <span>⚠️</span>
          <div>
            <strong>This looks like a Lightning UI URL.</strong>
            The REST API requires the My Domain URL. Suggested correction:<br>
            <code class="block mt-1 bg-amber-100 px-1.5 py-0.5 rounded font-mono break-all">${escHtml(normalized)}</code>
            <button id="btn-fix-url" class="mt-1.5 text-indigo-700 underline font-semibold hover:text-indigo-900">Apply correction</button>
          </div>
        </div>`;
    }
    return '';
  }

  // ── Auth persistence ──────────────────────────────────────────────────────

  _loadAuth() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_AUTH_KEY) || '{}');
      return {
        type:         saved.type        || 'token',
        instanceUrl:  saved.instanceUrl || '',
        clientId:     saved.clientId    || '',
        clientSecret: '',         // never persist secrets
        accessToken:  '',         // never persist tokens
        loginUrl:     saved.loginUrl    || 'https://test.salesforce.com',
        username:     saved.username    || '',
        password:     '',         // never persist passwords
      };
    } catch { return { type: 'token', instanceUrl: '', clientId: '', clientSecret: '', accessToken: '', loginUrl: 'https://test.salesforce.com', username: '', password: '' }; }
  }

  _saveAuth() {
    try {
      localStorage.setItem(LS_AUTH_KEY, JSON.stringify({
        type:        this._auth.type,
        instanceUrl: this._auth.instanceUrl,
        clientId:    this._auth.clientId,
        loginUrl:    this._auth.loginUrl,
        username:    this._auth.username,
        // secrets, tokens, passwords are intentionally NOT saved
      }));
    } catch { /* ignore quota errors */ }
  }

  _syncAuthFromInputs() {
    const g = id => this.querySelector(id)?.value || '';
    this._auth.clientId      = g('#auth-clientId');
    this._auth.clientSecret  = g('#auth-clientSecret');
    this._auth.accessToken   = g('#auth-accessToken');
    this._auth.loginUrl      = g('#auth-loginUrl') || this._auth.loginUrl;
    this._auth.username      = g('#auth-username');
    this._auth.password      = g('#auth-password');
    // Always normalize the instance URL before running — corrects lightning.force.com silently
    this._auth.instanceUrl   = normalizeInstanceUrl(g('#auth-instanceUrl'));
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

customElements.define('sf-execute-panel', SfExecutePanel);
