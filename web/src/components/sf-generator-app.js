import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { ACTION_TYPES, actionDescription, createAction, sheetCatalog } from '../actions.js';
import { notify, replaceState, resetState, restoreDraft, state, subscribe, uid } from '../state.js';
import { analyzeSharedScript, buildSharedScript, generateYaml, parseSharedScript, parseYaml } from '../yaml.js';
import { esc, toast } from '../utils.js';
import { checkDaemon, daemonPossible, fetchAuth, fetchConfig, loadSession, saveSession, runPipeline } from '../execute.js';
import './sf-action-modal.js';
import './sf-diagram-panel.js';

class SfGeneratorApp extends HTMLElement {
  constructor() {
    super();
    this.lastValidYaml = '';
    this.validation = { valid: true, issues: [] };
    this.unsubscribe = null;
    this.dragIndex = null;
    // Execution (Run) state — only meaningful when the UI daemon is reachable.
    this.daemon = null;         // /status payload, or null when unreachable
    this.auth = null;           // /auth payload (env credential, sf orgs)
    this.run = {
      source: 'sf',
      org: '',
      running: false,
      logLines: [],
      result: null,
      error: '',
    };
    const session = loadSession();
    this.run.instanceUrl = session.instanceUrl || '';
    this.run.accessToken = session.accessToken || '';
  }

  connectedCallback() {
    restoreDraft();
    this.unsubscribe = subscribe(reason => {
      if (reason === 'input') this.refreshPreview();
      else this.render();
    });
    this.render();
    this.detectDaemon();
  }

  // Detects the daemon once, then loads the local auth environment so the Run tab
  // can offer the org picker / paste-token flow.
  async detectDaemon() {
    if (!daemonPossible()) return;
    const status = await checkDaemon();
    if (!status) return;
    this.daemon = status;
    // Disk wins: when the daemon's folder already has a conf.yaml, load it (and its
    // scripts.js) through the normal import path, replacing the autosaved draft.
    try {
      const config = await fetchConfig();
      if (config.hasConf && config.yaml) {
        this.importText(config.yaml, config.script || '', 'Loaded conf.yaml from the daemon folder');
      }
    } catch {
      /* no config on disk, or unreadable — keep the current draft */
    }
    try {
      this.auth = await fetchAuth();
      this.run.source = this.auth.recommendedSource || 'paste';
      const def = (this.auth.orgs || []).find(org => org.isDefault) || (this.auth.orgs || [])[0];
      if (def) this.run.org = def.alias || def.username;
    } catch {
      this.auth = { envCredential: null, sfAvailable: false, orgs: [], recommendedSource: 'paste' };
      this.run.source = 'paste';
    }
    this.render();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render() {
    const result = generateYaml(state);
    this.validation = result;
    if (result.valid) this.lastValidYaml = result.yaml;
    this.innerHTML = `
      <header class="app-header">
        <div class="brand">
          <div class="brand-mark">SF</div>
          <div>
            <h1>YAML Configuration Generator</h1>
            <p>Build a clear, validated Salesforce data pipeline.</p>
          </div>
        </div>
        <div class="header-actions">
          <span class="autosave-status"><span></span> Draft autosaved</span>
          <button class="button ghost" data-reset>Reset</button>
          <button class="button secondary" data-copy ${result.valid ? '' : 'disabled'}>Copy YAML</button>
          <button class="button primary" data-download ${result.valid ? '' : 'disabled'}>Download</button>
        </div>
      </header>

      <nav class="mobile-tabs" aria-label="Generator sections">
        ${this.tabs()}
      </nav>

      <main class="workspace ${state.activeTab === 'diagram' || state.activeTab === 'run' ? 'workspace-full' : ''}">
        <section class="editor-pane ${state.activeTab === 'diagram' ? 'editor-pane-diagram' : ''}">
          <nav class="editor-tabs" aria-label="Configuration sections">${this.tabs(false)}</nav>
          <div class="editor-scroll ${state.activeTab === 'diagram' ? 'editor-scroll-diagram' : ''}">
            ${state.activeTab === 'app' ? this.appPanel() : ''}
            ${state.activeTab === 'sheets' ? this.sheetsPanel() : ''}
            ${state.activeTab === 'actions' ? this.actionsPanel() : ''}
            ${state.activeTab === 'preview' ? this.previewPanel(true) : ''}
            ${state.activeTab === 'diagram' ? '<sf-diagram-panel></sf-diagram-panel>' : ''}
            ${state.activeTab === 'run' ? this.runPanel() : ''}
          </div>
        </section>
        ${state.activeTab === 'diagram' || state.activeTab === 'run' ? '' : `<aside class="preview-pane">${this.previewPanel(false)}</aside>`}
      </main>

      <sf-action-modal></sf-action-modal>
      <input type="file" id="yaml-file" accept=".yaml,.yml,.js,.cjs,text/yaml,text/javascript" multiple hidden>
      <input type="file" id="input-files" accept=".csv,.xlsx,.xls,text/csv" multiple hidden>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>`;
    this.bind();
  }

  tabs(includePreview = true) {
    let n = 0;
    const items = [
      ['app', String(++n), 'App'],
      ['sheets', String(++n), `Sheets ${state.sheets.length ? `(${state.sheets.length})` : ''}`],
      ['actions', String(++n), `Actions ${state.actions.length ? `(${state.actions.length})` : ''}`],
      ...(includePreview ? [['preview', String(++n), 'Preview']] : []),
      ['diagram', String(++n), 'Diagram'],
      ...(this.daemon ? [['run', String(++n), '▶ Run']] : []),
    ];
    return items.map(([value, number, label]) => `
      <button class="tab ${state.activeTab === value ? 'active' : ''}" data-tab="${value}">
        <span>${number}</span>${label}
      </button>`).join('');
  }

  appPanel() {
    const app = state.appConfiguration;
    const issues = this.validation.issues.filter(issue => issue.section === 'app');
    return `<section class="panel-section">
      <div class="section-heading">
        <div><p class="eyebrow">Step 1</p><h2>Application settings</h2></div>
        <span class="status-pill">Required</span>
      </div>
      <p class="section-intro">Choose how Salesforce operations run. Authentication uses environment credentials when present, otherwise the active default org from <code>sf</code>.</p>
      <div class="card form-grid two">
        <label class="field">
          <span>Processing type <b>*</b></span>
          <select data-app="processingType">
            <option value="api" ${app.processingType === 'api' ? 'selected' : ''}>Synchronous API</option>
            <option value="bulk" ${app.processingType === 'bulk' ? 'selected' : ''}>Bulk API v2 — large data sets</option>
            <option value="auto" ${app.processingType === 'auto' ? 'selected' : ''}>Auto — best method per action</option>
          </select>
        </label>
        ${app.processingType === 'auto' ? `
        <label class="field">
          <span>Auto Bulk threshold</span>
          <input data-app="autoBulkThreshold" type="number" min="1" value="${esc(app.autoBulkThreshold ?? 10000)}" placeholder="10000">
          <small class="hint">Records at or above this count use Bulk API v2; below it, the synchronous API.</small>
        </label>` : ''}
        <label class="field">
          <span>Salesforce API version <b>*</b></span>
          <input data-app="apiVersion" value="${esc(app.apiVersion)}" placeholder="58.0">
        </label>
        <label class="field">
          <span>Query API batch size</span>
          <input data-app="queryApiBatchSize" type="number" min="200" max="2000" value="${esc(app.queryApiBatchSize ?? 2000)}" placeholder="2000">
          <small class="hint">REST Query page size (200–2000), used when Bulk Query cannot return selected compound fields.</small>
        </label>
        <label class="field">
          <span>Bulk maximum wait (seconds)</span>
          <input data-app="bulkApiMaxWaitSec" type="number" min="1" value="${esc(app.bulkApiMaxWaitSec ?? '')}" placeholder="Runtime default: 300">
          <small class="hint">Leave empty to use the runtime default.</small>
        </label>
        <label class="field">
          <span>Bulk poll interval (seconds)</span>
          <input data-app="bulkApiPollIntervalSec" type="number" min="1" value="${esc(app.bulkApiPollIntervalSec ?? '')}" placeholder="Runtime default: 5">
          <small class="hint">Leave empty to use the runtime default.</small>
        </label>
        <label class="check-field cleanup-option">
          <input data-app="cleanOutputFolderBeforeExecution" type="checkbox" ${app.cleanOutputFolderBeforeExecution ? 'checked' : ''}>
          <span>
            <strong>Clean output folder before execution</strong>
            <small>Deletes every existing item in the selected output folder.</small>
          </span>
        </label>
        <label class="check-field cleanup-option">
          <input data-app="deleteErrorFilesBeforeExecution" type="checkbox" ${app.deleteErrorFilesBeforeExecution ? 'checked' : ''}>
          <span>
            <strong>Delete previous error CSV files</strong>
            <small>Removes generated <code>-errors.csv</code> and configured error-sheet files.</small>
          </span>
        </label>
      </div>
      ${issues.length ? `<div class="form-error section-errors">${issues.map(issue => esc(issue.message)).join('<br>')}</div>` : ''}
    </section>`;
  }

  sheetsPanel() {
    return `<section class="panel-section">
      <div class="section-heading">
        <div><p class="eyebrow">Step 2</p><h2>Input sheet mappings</h2></div>
        <div class="section-actions">
          ${state.sheets.length ? `
            <button class="button secondary compact-button" data-expand-all-sheets>Expand all</button>
            <button class="button secondary compact-button" data-collapse-all-sheets>Collapse all</button>
          ` : ''}
          <button class="button secondary" data-load-inputs>Load CSV / Excel</button>
          <button class="button primary" data-add-sheet>+ Add manually</button>
        </div>
      </div>
      <p class="section-intro">Load files to discover sheet names and columns automatically. Enable translation only where an input label must become a real API field name.</p>
      <div class="stack">
        ${state.sheets.length ? state.sheets.map((sheet, sheetIndex) => this.sheetCard(sheet, sheetIndex)).join('') : `
          <div class="empty-state">
            <div class="empty-icon">▦</div>
            <h3>No mappings needed yet</h3>
            <p>Load CSV or Excel headers, or add a logical sheet manually.</p>
            <button class="button secondary" data-load-inputs>Load input files</button>
          </div>`}
      </div>
    </section>`;
  }

  sheetCard(sheet, sheetIndex) {
    const issues = this.validation.issues.filter(issue => issue.path[0] === 'sheets' && issue.path[1] === sheetIndex);
    return `<article class="card sheet-card ${sheet.collapsed ? 'collapsed' : ''} ${issues.length ? 'invalid' : ''}">
      <div class="card-header">
        <div class="sheet-title">
          <button class="collapse-button" data-toggle-sheet="${sheetIndex}" aria-expanded="${!sheet.collapsed}" aria-label="${sheet.collapsed ? 'Expand' : 'Collapse'} sheet ${esc(sheet.name || String(sheetIndex + 1))}">
            ${sheet.collapsed ? '▸' : '▾'}
          </button>
          <span class="step-number">${sheetIndex + 1}</span>
          <label class="field compact">
            <span>Logical sheet name <b>*</b></span>
            <input data-sheet-name="${sheetIndex}" value="${esc(sheet.name)}" placeholder="CSV filename or Excel tab">
          </label>
          ${sheet.source ? `<span class="source-pill">${esc(sheet.source.fileName)}${sheet.source.worksheet ? ` · ${esc(sheet.source.worksheet)}` : ''}</span>` : ''}
        </div>
        <button class="icon-button danger" data-remove-sheet="${sheetIndex}" aria-label="Remove sheet">×</button>
      </div>
      ${sheet.collapsed ? '' : `<div class="mapping-list">
        <div class="mapping-head"><span>Input column</span><span>Translate?</span><span>API field name</span><span></span></div>
        ${sheet.fields.map((field, fieldIndex) => `
          <div class="mapping-row">
            <input data-sheet-field="${sheetIndex}:${fieldIndex}:name" value="${esc(field.name)}" placeholder="Company Name">
            <label class="mapping-toggle">
              <input type="checkbox" data-sheet-translate="${sheetIndex}:${fieldIndex}" ${field.translate ? 'checked' : ''}>
              <span>${field.translate ? 'Yes' : 'No'}</span>
            </label>
            <input data-sheet-field="${sheetIndex}:${fieldIndex}:apiName" value="${esc(field.apiName)}" placeholder="${field.translate ? 'Name' : 'No translation'}" ${field.translate ? '' : 'disabled'}>
            <button class="icon-button" data-remove-mapping="${sheetIndex}:${fieldIndex}" aria-label="Remove mapping">×</button>
          </div>`).join('')}
        <button class="text-button" data-add-mapping="${sheetIndex}">+ Add column mapping</button>
        ${issues.length ? `<div class="field-error">${issues.map(issue => esc(issue.message)).join(' · ')}</div>` : ''}
      </div>`}
    </article>`;
  }

  actionsPanel() {
    return `<section class="panel-section">
      <div class="section-heading">
        <div><p class="eyebrow">Step 3</p><h2>Pipeline actions</h2></div>
        <button class="button primary" data-add-action>+ Add action</button>
      </div>
      <p class="section-intro">Each step performs one operation. Drag cards to change the exact execution order.</p>
      ${state.actions.length ? `
        <div class="pipeline-flow" aria-label="Pipeline overview">
          ${state.actions.map((action, index) => `${index ? '<span class="flow-arrow">→</span>' : ''}<span class="flow-node type-${action.type}">${action.type.toUpperCase()}</span>`).join('')}
        </div>
        <div class="stack actions-list">
          ${state.actions.map((action, index) => this.actionCard(action, index)).join('')}
        </div>` : `
        <div class="empty-state">
          <div class="empty-icon">⇢</div>
          <h3>Your pipeline is empty</h3>
          <p>Add one focused action for each GET, write, or transformation step.</p>
          <button class="button secondary" data-add-action>Add first action</button>
        </div>`}
    </section>`;
  }

  actionCard(action, index) {
    const issueCount = this.validation.issues.filter(issue => issue.actionIndex === index).length;
    return `<article class="card action-card ${issueCount ? 'invalid' : ''}" draggable="true" data-action-index="${index}">
      <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
      <span class="step-number">${index + 1}</span>
      <span class="type-badge type-${action.type}">${action.type.toUpperCase()}</span>
      <div class="action-summary">
        <h3>${esc(action.name || 'Unnamed action')}</h3>
        <p>${esc(actionDescription(action))}</p>
        ${issueCount ? `<small class="field-error">${issueCount} validation ${issueCount === 1 ? 'issue' : 'issues'}</small>` : ''}
      </div>
      <div class="card-actions">
        <button class="icon-button" data-move-action="${index}:-1" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button" data-move-action="${index}:1" title="Move down" ${index === state.actions.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-button" data-duplicate-action="${index}" title="Duplicate">⧉</button>
        <button class="icon-button" data-edit-action="${index}" title="Edit">✎</button>
        <button class="icon-button danger" data-remove-action="${index}" title="Delete">×</button>
      </div>
    </article>`;
  }

  previewPanel(mobile) {
    const valid = this.validation.valid;
    return `<section class="preview-card ${mobile ? 'mobile-preview' : ''}">
      <div class="preview-header">
        <div>
          <p class="eyebrow">Live output</p>
          <h2>Configuration YAML</h2>
        </div>
        <span class="validation-status ${valid ? 'valid' : 'invalid'}">${valid ? '✓ Valid' : `! ${this.validation.issues.length} issues`}</span>
      </div>
      ${valid ? '' : `
        <div class="error-summary">
          <strong>Fix these fields before copying or downloading:</strong>
          <ul>${this.validation.issues.slice(0, 8).map((issue, index) => `
            <li><button data-issue="${index}"><code>${esc(issue.pathText || 'configuration')}</code> ${esc(issue.message)}</button></li>`).join('')}</ul>
        </div>`}
      <pre class="yaml-preview"><code>${esc(this.lastValidYaml || '# Complete the required fields to generate YAML.')}</code></pre>
      <div class="preview-actions">
        <button class="button secondary" data-copy ${valid ? '' : 'disabled'}>Copy</button>
        <button class="button primary" data-download ${valid ? '' : 'disabled'}>Download conf.yaml</button>
      </div>
      <details class="import-panel">
        <summary>Import existing YAML</summary>
        <p>Canonical YAML is validated and normalized. Comments and formatting are not preserved. Select the <code>conf.yaml</code> and its shared script file together to preload every transform.</p>
        <textarea id="yaml-import-text" rows="6" placeholder="Paste YAML here…"></textarea>
        <div class="import-actions">
          <button class="button ghost" data-choose-file>Choose .yaml + script</button>
          <button class="button secondary" data-import-text>Load pasted YAML</button>
        </div>
      </details>
    </section>`;
  }

  runPanel() {
    const valid = this.validation.valid;
    const auth = this.auth || { orgs: [], sfAvailable: false, envCredential: null };
    const run = this.run;
    const orgs = auth.orgs || [];
    const actions = state.actions;

    const sourceOption = (value, label, disabled = false) => `
      <label class="run-source ${run.source === value ? 'active' : ''} ${disabled ? 'disabled' : ''}">
        <input type="radio" name="run-source" value="${value}" ${run.source === value ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span>${label}</span>
      </label>`;

    const orgPicker = `
      <label class="field">
        <span>Salesforce org</span>
        <select data-run-org ${run.source === 'sf' ? '' : 'disabled'}>
          ${orgs.map(org => {
            const key = org.alias || org.username;
            const label = org.alias ? `${org.alias} — ${org.username}` : org.username;
            return `<option value="${esc(key)}" ${run.org === key ? 'selected' : ''}>${esc(label)}${org.isDefault ? ' (default)' : ''}</option>`;
          }).join('')}
        </select>
        <small class="hint">A fresh access token is fetched from the Salesforce CLI for the selected org at run time.</small>
      </label>`;

    const pasteFields = `
      <div class="run-paste ${run.source === 'paste' ? '' : 'hidden'}">
        <label class="field">
          <span>Instance URL</span>
          <input data-run-instance value="${esc(run.instanceUrl || '')}" placeholder="https://your-domain.my.salesforce.com">
        </label>
        <label class="field">
          <span>Access token</span>
          <input data-run-token type="password" value="${esc(run.accessToken || '')}" placeholder="Bearer access token">
          <small class="hint">Kept only for this browser session; never written to disk or the config draft.</small>
        </label>
      </div>`;

    return `<section class="panel-section run-panel">
      <div class="section-heading">
        <div><p class="eyebrow">Execute</p><h2>Run pipeline</h2></div>
        <span class="daemon-status ok">● Daemon connected${this.daemon?.cwd ? ` · ${esc(this.daemon.cwd)}` : ''}</span>
      </div>
      <p class="section-intro">Runs the pipeline in the daemon's folder. The current <code>conf.yaml</code>${state.actions.some(a => a.type === 'transform') ? ' and <code>scripts.js</code>' : ''} are written before execution, exactly as if you had saved and run the CLI there.</p>

      <div class="card run-config">
        <div class="run-field-group">
          <span class="run-label">Authentication</span>
          <div class="run-sources">
            ${sourceOption('env', auth.envCredential ? `.env (${auth.envCredential})` : '.env file', !auth.envCredential)}
            ${sourceOption('sf', 'Salesforce CLI org', !orgs.length)}
            ${sourceOption('paste', 'Paste a token')}
          </div>
        </div>
        ${orgs.length ? orgPicker : ''}
        ${pasteFields}

        <div class="run-field-group">
          <span class="run-label">Action range (optional)</span>
          <div class="form-grid two">
            <label class="field">
              <span>From action</span>
              <select data-run-from>
                <option value="">First action</option>
                ${actions.map((a, i) => `<option value="${esc(a.name)}" ${run.fromTask === a.name ? 'selected' : ''}>${i + 1}. ${esc(a.name || 'Unnamed')}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>To action</span>
              <select data-run-to>
                <option value="">Last action</option>
                ${actions.map((a, i) => `<option value="${esc(a.name)}" ${run.toTask === a.name ? 'selected' : ''}>${i + 1}. ${esc(a.name || 'Unnamed')}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>

        <div class="run-actions">
          <button class="button primary" data-run-start ${!valid || run.running ? 'disabled' : ''}>
            ${run.running ? 'Running…' : '▶ Run pipeline'}
          </button>
          ${valid ? '' : '<span class="field-error">Fix configuration issues before running.</span>'}
        </div>
      </div>

      ${run.error ? `<div class="form-error section-errors">${esc(run.error)}</div>` : ''}

      ${run.logLines.length || run.running ? `
        <div class="card run-console">
          <div class="run-console-head">
            <span>Execution log</span>
            ${run.running ? '<span class="run-spinner">● live</span>' : ''}
          </div>
          <pre class="run-log"><code>${esc(run.logLines.join('\n'))}</code></pre>
        </div>` : ''}

      ${run.result ? `
        <div class="card run-result ${run.result.status === 'success' ? 'ok' : 'bad'}">
          <h3>${run.result.status === 'success' ? '✓ Pipeline finished successfully' : `✗ Pipeline failed (exit ${run.result.exitCode})`}</h3>
          ${run.result.outputs?.length ? `
            <table class="run-output-table">
              <thead><tr><th>Output file</th><th>Rows</th></tr></thead>
              <tbody>
                ${run.result.outputs.map(o => `<tr><td>${esc(o.name)}</td><td>${o.rows}</td></tr>`).join('')}
              </tbody>
            </table>
            <small class="hint">Files were written to the output folder in the daemon's working directory.</small>
          ` : '<p>No output files were reported.</p>'}
        </div>` : ''}
    </section>`;
  }

  bind() {
    this.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      notify('tab');
    }));
    this.querySelectorAll('[data-app]').forEach(input => input.addEventListener('input', () => {
      state.appConfiguration[input.dataset.app] = input.type === 'checkbox' ? input.checked : input.value;
      // Switching processingType shows/hides mode-specific fields (e.g. the auto
      // threshold), so re-render the panel rather than only refreshing the preview.
      notify(input.dataset.app === 'processingType' ? 'structure' : 'input');
    }));
    this.querySelectorAll('[data-toggle-sheet]').forEach(button => button.addEventListener('click', () => {
      const sheet = state.sheets[Number(button.dataset.toggleSheet)];
      sheet.collapsed = !sheet.collapsed;
      notify('structure');
    }));
    this.querySelectorAll('[data-expand-all-sheets]').forEach(button => button.addEventListener('click', () => {
      state.sheets.forEach(sheet => { sheet.collapsed = false; });
      notify('structure');
    }));
    this.querySelectorAll('[data-collapse-all-sheets]').forEach(button => button.addEventListener('click', () => {
      state.sheets.forEach(sheet => { sheet.collapsed = true; });
      notify('structure');
    }));
    this.querySelectorAll('[data-add-sheet]').forEach(button => button.addEventListener('click', () => {
      state.sheets.push({ id: uid(), name: '', source: null, collapsed: false, fields: [] });
      notify('structure');
    }));
    this.querySelectorAll('[data-load-inputs]').forEach(button => button.addEventListener('click', () => {
      this.querySelector('#input-files').click();
    }));
    this.querySelector('#input-files').addEventListener('change', event => {
      this.loadInputFiles(Array.from(event.target.files || []));
      event.target.value = '';
    });
    this.querySelectorAll('[data-sheet-name]').forEach(input => input.addEventListener('input', () => {
      state.sheets[Number(input.dataset.sheetName)].name = input.value;
      notify('input');
    }));
    this.querySelectorAll('[data-remove-sheet]').forEach(button => button.addEventListener('click', () => {
      if (confirm('Remove this sheet mapping?')) {
        state.sheets.splice(Number(button.dataset.removeSheet), 1);
        notify('structure');
      }
    }));
    this.querySelectorAll('[data-add-mapping]').forEach(button => button.addEventListener('click', () => {
      state.sheets[Number(button.dataset.addMapping)].fields.push({ id: uid(), name: '', apiName: '', translate: true });
      notify('structure');
    }));
    this.querySelectorAll('[data-sheet-field]').forEach(input => input.addEventListener('input', () => {
      const [sheetIndex, fieldIndex, property] = input.dataset.sheetField.split(':');
      state.sheets[Number(sheetIndex)].fields[Number(fieldIndex)][property] = input.value;
      notify('input');
    }));
    this.querySelectorAll('[data-sheet-translate]').forEach(input => input.addEventListener('change', () => {
      const [sheetIndex, fieldIndex] = input.dataset.sheetTranslate.split(':').map(Number);
      const field = state.sheets[sheetIndex].fields[fieldIndex];
      field.translate = input.checked;
      if (!input.checked) field.apiName = '';
      notify('structure');
    }));
    this.querySelectorAll('[data-remove-mapping]').forEach(button => button.addEventListener('click', () => {
      const [sheetIndex, fieldIndex] = button.dataset.removeMapping.split(':').map(Number);
      state.sheets[sheetIndex].fields.splice(fieldIndex, 1);
      notify('structure');
    }));
    this.querySelectorAll('[data-add-action]').forEach(button => button.addEventListener('click', () => this.openAction(-1)));
    this.querySelectorAll('[data-edit-action]').forEach(button => button.addEventListener('click', () => this.openAction(Number(button.dataset.editAction))));
    this.querySelectorAll('[data-duplicate-action]').forEach(button => button.addEventListener('click', () => {
      const source = state.actions[Number(button.dataset.duplicateAction)];
      this.openAction(-1, createAction(source.type, { ...source, id: undefined, name: `Copy of ${source.name}` }));
    }));
    this.querySelectorAll('[data-move-action]').forEach(button => button.addEventListener('click', () => {
      const [index, direction] = button.dataset.moveAction.split(':').map(Number);
      const target = index + direction;
      if (target < 0 || target >= state.actions.length) return;
      [state.actions[index], state.actions[target]] = [state.actions[target], state.actions[index]];
      notify('structure');
    }));
    this.querySelectorAll('[data-remove-action]').forEach(button => button.addEventListener('click', () => {
      if (confirm('Delete this pipeline action?')) {
        state.actions.splice(Number(button.dataset.removeAction), 1);
        notify('structure');
      }
    }));
    this.querySelectorAll('[data-action-index]').forEach(card => {
      card.addEventListener('dragstart', () => {
        this.dragIndex = Number(card.dataset.actionIndex);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', event => event.preventDefault());
      card.addEventListener('drop', event => {
        event.preventDefault();
        const target = Number(card.dataset.actionIndex);
        if (this.dragIndex === null || this.dragIndex === target) return;
        const [moved] = state.actions.splice(this.dragIndex, 1);
        state.actions.splice(target, 0, moved);
        this.dragIndex = null;
        notify('structure');
      });
    });
    this.querySelector('sf-action-modal').addEventListener('action-save', event => {
      const { action, index } = event.detail;
      if (index < 0) state.actions.push(action);
      else state.actions[index] = action;
      notify('structure');
    });
    this.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', () => this.copyYaml()));
    this.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => this.downloadYaml()));
    this.querySelectorAll('[data-reset]').forEach(button => button.addEventListener('click', () => {
      if (confirm('Reset the entire configuration? This clears the autosaved draft.')) resetState();
    }));
    this.querySelectorAll('[data-choose-file]').forEach(button => button.addEventListener('click', () => this.querySelector('#yaml-file').click()));
    this.querySelector('#yaml-file').addEventListener('change', event => {
      this.importFiles(Array.from(event.target.files || []));
      event.target.value = '';
    });
    this.querySelectorAll('[data-import-text]').forEach(button => button.addEventListener('click', () => {
      const text = button.closest('.preview-card').querySelector('#yaml-import-text').value;
      this.importText(text);
    }));
    this.querySelectorAll('[data-issue]').forEach(button => button.addEventListener('click', () => {
      const issue = this.validation.issues[Number(button.dataset.issue)];
      if (issue.actionIndex !== null) this.openAction(issue.actionIndex, undefined, issue.path[2]);
      else {
        state.activeTab = issue.section;
        notify('tab');
      }
    }));
    this.bindRunPanel();
    this.querySelector('sf-diagram-panel')?.update(state);
  }

  bindRunPanel() {
    this.querySelectorAll('input[name="run-source"]').forEach(input => input.addEventListener('change', () => {
      this.run.source = input.value;
      this.render();
    }));
    const orgSelect = this.querySelector('[data-run-org]');
    orgSelect?.addEventListener('change', () => { this.run.org = orgSelect.value; });
    const instance = this.querySelector('[data-run-instance]');
    instance?.addEventListener('input', () => {
      this.run.instanceUrl = instance.value;
      saveSession({ instanceUrl: this.run.instanceUrl, accessToken: this.run.accessToken });
    });
    const token = this.querySelector('[data-run-token]');
    token?.addEventListener('input', () => {
      this.run.accessToken = token.value;
      saveSession({ instanceUrl: this.run.instanceUrl, accessToken: this.run.accessToken });
    });
    const from = this.querySelector('[data-run-from]');
    from?.addEventListener('change', () => { this.run.fromTask = from.value || undefined; });
    const to = this.querySelector('[data-run-to]');
    to?.addEventListener('change', () => { this.run.toTask = to.value || undefined; });
    this.querySelector('[data-run-start]')?.addEventListener('click', () => this.startRun());
  }

  async startRun() {
    if (this.run.running) return;
    const result = generateYaml(state);
    if (!result.valid) {
      toast('Fix configuration issues before running.', 'warning');
      return;
    }
    const hasTransform = state.actions.some(action => action.type === 'transform');

    // Build the auth payload from the selected source.
    const auth = { source: this.run.source };
    if (this.run.source === 'sf') {
      if (!this.run.org) { toast('Pick a Salesforce org first.', 'warning'); return; }
      auth.org = this.run.org;
    } else if (this.run.source === 'paste') {
      if (!this.run.instanceUrl || !this.run.accessToken) {
        toast('Enter an instance URL and access token.', 'warning');
        return;
      }
      auth.instanceUrl = this.run.instanceUrl;
      auth.accessToken = this.run.accessToken;
    }

    // Confirm before writing files and hitting the org.
    const host = this.confirmHost(auth);
    const rangeText = this.run.fromTask || this.run.toTask
      ? ` (range: ${this.run.fromTask || 'first'} → ${this.run.toTask || 'last'})`
      : '';
    if (!confirm(`Run ${state.actions.length} action(s)${rangeText} against ${host}?\n\nconf.yaml${hasTransform ? ' and scripts.js' : ''} will be overwritten in the daemon's folder.`)) {
      return;
    }

    this.run.running = true;
    this.run.logLines = [];
    this.run.result = null;
    this.run.error = '';
    this.render();

    const appendLine = line => {
      this.run.logLines.push(line);
      const log = this.querySelector('.run-log code');
      if (log) {
        log.textContent = this.run.logLines.join('\n');
        log.parentElement.scrollTop = log.parentElement.scrollHeight;
      }
    };

    try {
      const runResult = await runPipeline(
        {
          yaml: result.yaml,
          script: hasTransform ? buildSharedScript(state) : undefined,
          hasTransform,
          auth,
          fromTask: this.run.fromTask,
          toTask: this.run.toTask,
        },
        { onLine: appendLine, onResult: res => { this.run.result = res; } }
      );
      this.run.result = runResult || this.run.result;
    } catch (error) {
      this.run.error = error.message;
      if (error.needsToken) {
        this.run.source = 'paste';
        toast('That org needs a fresh login. Paste a token instead.', 'warning', 6000);
      }
    } finally {
      this.run.running = false;
      this.render();
    }
  }

  confirmHost(auth) {
    if (auth.source === 'paste' && auth.instanceUrl) {
      try { return new URL(auth.instanceUrl).host; } catch { return auth.instanceUrl; }
    }
    if (auth.source === 'sf') {
      const org = (this.auth?.orgs || []).find(o => (o.alias || o.username) === auth.org);
      if (org) { try { return new URL(org.instanceUrl).host; } catch { return org.instanceUrl; } }
      return auth.org;
    }
    return 'the .env-configured org';
  }

  refreshPreview() {
    const result = generateYaml(state);
    this.validation = result;
    if (result.valid) this.lastValidYaml = result.yaml;
    this.querySelectorAll('.preview-card').forEach(card => {
      const code = card.querySelector('.yaml-preview code');
      if (code) code.textContent = this.lastValidYaml || '# Complete the required fields to generate YAML.';
      const status = card.querySelector('.validation-status');
      if (status) {
        status.className = `validation-status ${result.valid ? 'valid' : 'invalid'}`;
        status.textContent = result.valid ? '✓ Valid' : `! ${result.issues.length} issues`;
      }
      const existingSummary = card.querySelector('.error-summary');
      if (result.valid) {
        existingSummary?.remove();
      } else {
        const summary = document.createElement('div');
        summary.className = 'error-summary';
        summary.innerHTML = this.issueSummary();
        summary.querySelectorAll('[data-issue]').forEach(button => button.addEventListener('click', () => {
          const issue = this.validation.issues[Number(button.dataset.issue)];
          if (issue.actionIndex !== null) this.openAction(issue.actionIndex, undefined, issue.path[2]);
          else {
            state.activeTab = issue.section;
            notify('tab');
          }
        }));
        if (existingSummary) existingSummary.replaceWith(summary);
        else card.querySelector('.yaml-preview').before(summary);
      }
    });
    this.querySelectorAll('[data-copy],[data-download]').forEach(button => { button.disabled = !result.valid; });
  }

  issueSummary() {
    return `<strong>Fix these fields before copying or downloading:</strong>
      <ul>${this.validation.issues.slice(0, 8).map((issue, index) => `
        <li><button data-issue="${index}"><code>${esc(issue.pathText || 'configuration')}</code> ${esc(issue.message)}</button></li>`).join('')}</ul>`;
  }

  openAction(index, suppliedAction, focusField) {
    const action = suppliedAction || (index < 0 ? createAction('get') : state.actions[index]);
    const others = state.actions.filter((_item, itemIndex) => itemIndex !== index);
    this.querySelector('sf-action-modal').open(
      action,
      index,
      sheetCatalog(state, index < 0 ? state.actions.length : index),
      others,
      focusField
    );
  }

  async copyYaml() {
    const result = generateYaml(state);
    if (!result.valid) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.yaml);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = result.yaml;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      toast('YAML copied');
    } catch {
      toast('Clipboard access was blocked; select the preview text manually.', 'error');
    }
  }

  async downloadYaml() {
    const result = generateYaml(state);
    if (!result.valid) return;
    await this.saveFile(result.yaml, 'conf.yaml', 'text/yaml', 'YAML configuration', ['.yaml', '.yml']);

    // Transform scripts travel in a single shared file so importing preloads them all.
    // The CLI receives this file via --scriptFile; the YAML no longer names it.
    if (state.actions.some(action => action.type === 'transform')) {
      await this.saveFile(buildSharedScript(state), 'scripts.js', 'text/javascript', 'CommonJS JavaScript', ['.js', '.cjs']);
    }
  }

  async saveFile(content, suggestedName, mime, description, extensions) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description, accept: { [mime]: extensions } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        toast(`Saved ${handle.name}`);
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: mime }));
    link.download = suggestedName;
    link.click();
    URL.revokeObjectURL(link.href);
    toast(`${suggestedName} downloaded`);
  }

  async loadInputFiles(files) {
    if (!files.length) return;
    try {
      for (const file of files) {
        const extension = file.name.split('.').pop().toLowerCase();
        if (extension === 'csv') {
          const parsed = Papa.parse(await file.text(), { preview: 1, skipEmptyLines: true });
          const headers = this.normalizeHeaders(parsed.data?.[0] || []);
          this.addDiscoveredSheet(file.name.replace(/\.[^.]+$/, ''), headers, {
            kind: 'csv',
            fileName: file.name,
          });
        } else if (extension === 'xlsx' || extension === 'xls') {
          const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
          workbook.SheetNames.forEach(worksheet => {
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[worksheet], {
              header: 1,
              blankrows: false,
              defval: '',
            });
            if (!rows.length) return;
            const headers = this.normalizeHeaders(rows[0]);
            if (headers.length) {
              this.addDiscoveredSheet(worksheet, headers, {
                kind: 'excel',
                fileName: file.name,
                worksheet,
              });
            }
          });
        } else {
          throw new Error(`Unsupported input file "${file.name}".`);
        }
      }
      notify('structure');
      toast(`Loaded headers from ${files.length} input ${files.length === 1 ? 'file' : 'files'}`);
    } catch (error) {
      toast(`Could not inspect input files: ${error.message}`, 'error', 6000);
    }
  }

  addDiscoveredSheet(name, headers, source) {
    if (!headers.length) throw new Error(`No header row was found in "${source.fileName}".`);
    const existing = state.sheets.find(sheet => sheet.name.toLowerCase() === name.toLowerCase());
    if (existing && !confirm(`Replace the detected columns for sheet "${existing.name}"?`)) return;
    const previous = new Map((existing?.fields || []).map(field => [field.name.toLowerCase(), field]));
    const fields = headers.map(header => {
      const old = previous.get(header.toLowerCase());
      return old
        ? { ...old }
        : { id: uid(), name: header, apiName: '', translate: false };
    });
    if (existing) {
      existing.source = source;
      existing.fields = fields;
      existing.collapsed = false;
    } else {
      state.sheets.push({ id: uid(), name, source, collapsed: false, fields });
    }
  }

  normalizeHeaders(values) {
    const seen = new Set();
    return values
      .map(value => String(value ?? '').trim())
      .filter(value => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  async importFiles(files) {
    if (!files.length) return;
    const isYaml = file => /\.ya?ml$/i.test(file.name);
    const yamlFile = files.find(isYaml);
    const scriptFile = files.find(file => !isYaml(file));
    if (!yamlFile) {
      toast('Choose a .yaml file to import', 'warning');
      return;
    }
    try {
      const yamlText = await yamlFile.text();
      const scriptText = scriptFile ? await scriptFile.text() : '';
      this.importText(yamlText, scriptText);
    } catch (error) {
      toast(`Could not read that file: ${error.message}`, 'error', 6000);
    }
  }

  importText(text, scriptText = '', successMessage = 'Configuration imported and normalized') {
    if (!text.trim()) {
      toast('Paste YAML or choose a file first', 'warning');
      return;
    }
    try {
      const configuration = parseYaml(text);
      replaceState(configuration, 'import');
      this.applySharedScript(scriptText);
      toast(successMessage);
    } catch (error) {
      toast(`Import failed: ${error.message}`, 'error', 6000);
    }
  }

  // Distributes the shared script file's contents into each transform action's editor,
  // matching by action name, and reports precisely what could not be matched so the user
  // knows what is wrong instead of quietly getting blank editors.
  applySharedScript(scriptText) {
    const transforms = state.actions.filter(action => action.type === 'transform');
    const hasScript = Boolean(scriptText.trim());

    // No transforms in the YAML: a script file is pointless — say so rather than ignoring it.
    if (!transforms.length) {
      if (hasScript) {
        toast('This configuration has no transform actions, so the script file was not used.', 'warning', 6000);
      }
      return;
    }

    const names = transforms.map(action => action.name);
    const analysis = hasScript ? analyzeSharedScript(scriptText) : null;
    const scripts = hasScript ? parseSharedScript(scriptText, names) : null;

    // Report structural problems with the loaded file before applying anything.
    if (analysis) this.reportScriptFile(analysis, names);

    const missing = [];
    for (const action of transforms) {
      const content = scripts ? scripts[action.name] : undefined;
      if (content) {
        action.scriptContent = content;
      } else {
        action.scriptContent = '';
        missing.push(action.name);
      }
    }
    if (scripts && missing.length) {
      toast(`No matching function for: ${missing.join(', ')}. Opening those actions shows a fresh template.`, 'warning', 7000);
    }
    notify('structure');
  }

  // Surfaces what is wrong with a loaded script file: not a shared module, functions whose
  // keys match no action (typos / renamed actions), and module-level code that a UI
  // re-export would drop.
  reportScriptFile(analysis, actionNames) {
    if (!analysis.hasExports && !analysis.keys.length) {
      toast('The script file has no `module.exports` object keyed by action name; nothing could be loaded.', 'error', 8000);
      return;
    }
    const known = new Set(actionNames);
    const orphans = analysis.keys.filter(key => !known.has(key));
    if (orphans.length) {
      toast(`The script defines functions that match no transform action: ${orphans.join(', ')}. Check for renamed actions or typos.`, 'warning', 8000);
    }
    if (analysis.moduleLevel) {
      toast('The script has module-level code (const/require) above the exports. It runs in the CLI, but is not carried into the per-action editors and would be lost on a UI re-export.', 'warning', 9000);
    }
  }
}

customElements.define('sf-generator-app', SfGeneratorApp);
