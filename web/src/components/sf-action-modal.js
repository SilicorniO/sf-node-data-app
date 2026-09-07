import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import * as Papa from 'papaparse';
import { ACTION_TYPES, changeActionType, createAction, ensureIdentifierField } from '../actions.js';
import { issuesByField, validateActionDraft } from '../modal.js';
import { esc, toast } from '../utils.js';

class SfActionModal extends HTMLElement {
  constructor() {
    super();
    this.draft = null;
    this.index = -1;
    this.suggestions = [];
    this.sheetCatalog = [];
    this.otherActions = [];
    this.errors = {};
    this.scriptEditor = null;
    this.scriptFileHandle = null;
  }

  open(action, index, sheetCatalog, otherActions, focusField = 'name') {
    this.draft = createAction(action?.type || 'get', action || {});
    this.index = index;
    this.sheetCatalog = sheetCatalog;
    this.suggestions = sheetCatalog.map(sheet => sheet.name);
    this.otherActions = otherActions;
    this.errors = {};
    this.scriptFileHandle = null;
    if (this.draft.type === 'transform' && !this.draft.script && !this.draft.scriptContent) {
      this.draft.script = './transform.js';
      this.draft.scriptContent = this.transformTemplate();
    }
    this.render();
    requestAnimationFrame(() => this.querySelector(`[data-field="${focusField}"]`)?.focus());
  }

  close() {
    this.scriptEditor?.destroy();
    this.scriptEditor = null;
    this.innerHTML = '';
    this.draft = null;
  }

  render() {
    if (!this.draft) return;
    this.scriptEditor?.destroy();
    this.scriptEditor = null;
    const action = this.draft;
    this.innerHTML = `
      <div class="modal-backdrop" data-close>
        <form class="modal" aria-modal="true" role="dialog" aria-labelledby="action-modal-title">
          <header class="modal-header">
            <div>
              <p class="eyebrow">${this.index < 0 ? 'New pipeline step' : `Step ${this.index + 1}`}</p>
              <h2 id="action-modal-title">${this.index < 0 ? 'Add action' : 'Edit action'}</h2>
            </div>
            <button class="icon-button" type="button" data-close aria-label="Close">×</button>
          </header>
          <div class="modal-body">
            <div class="form-grid two">
              ${this.field('name', 'Action name', action.name, { required: true, placeholder: 'e.g. Get Accounts' })}
              <label class="field">
                <span>Action type <b>*</b></span>
                <select data-field="type">
                  ${ACTION_TYPES.map(type => `<option value="${type.value}" ${action.type === type.value ? 'selected' : ''}>${type.label} — ${type.description}</option>`).join('')}
                </select>
              </label>
            </div>

            <section class="type-fields">
              ${this.typeFields(action)}
            </section>

            <details class="advanced">
              <summary>
                <span>Error and timing</span>
                <small>Wait ${Number(action.waitBeforeSeconds) || 0}s · ${action.continueOnError ? 'continue' : 'stop'} on row errors</small>
              </summary>
              <div class="form-grid two advanced-body">
                ${this.field('waitBeforeSeconds', 'Wait before (seconds)', action.waitBeforeSeconds, { type: 'number', min: 0 })}
                <label class="field">
                  <span>Error rows</span>
                  <select data-field="errorRows">
                    <option value="errors" ${action.errorRows !== 'all' ? 'selected' : ''}>Only failed rows</option>
                    <option value="all" ${action.errorRows === 'all' ? 'selected' : ''}>All rows when any fails</option>
                  </select>
                </label>
                ${this.field('errorSheet', 'Error sheet', action.errorSheet, { placeholder: `${action.name || 'Action'}-errors (default)` })}
                <label class="check-field">
                  <input type="checkbox" data-field="continueOnError" ${action.continueOnError ? 'checked' : ''}>
                  <span><strong>Continue after row errors</strong><small>Fatal action errors always stop.</small></span>
                </label>
              </div>
            </details>

            ${this.errors.action ? `<div class="form-error">${this.errors.action.join('<br>')}</div>` : ''}
          </div>
          <footer class="modal-footer">
            <button type="button" class="button secondary" data-close>Cancel</button>
            <button type="submit" class="button primary">Save action</button>
          </footer>
        </form>
      </div>
      <datalist id="sheet-suggestions">
        ${this.suggestions.map(name => `<option value="${esc(name)}"></option>`).join('')}
      </datalist>`;
    this.bind();
    this.initializeScriptEditor();
  }

  typeFields(action) {
    if (action.type === 'get') {
      return `
        ${this.field('outputSheet', 'Output sheet', action.outputSheet, { required: true, list: true, placeholder: 'Accounts' })}
        ${this.field('query', 'SOQL query', action.query, { required: true, textarea: true, wide: true, placeholder: 'SELECT Id, Name FROM Account' })}`;
    }
    if (action.type === 'transform') {
      return `<div class="form-grid two">
        ${this.field('inputSheet', 'Input sheet', action.inputSheet, { required: true, list: true })}
        ${this.field('outputSheet', 'Output sheet', action.outputSheet, { required: true, list: true })}
        <div class="field wide">
          <span>CommonJS script <b>*</b></span>
          <div class="script-path-row">
            <input data-field="script" value="${esc(action.script)}" required placeholder="./transforms/accounts.js">
            <button type="button" class="button secondary" data-load-script>Load .js</button>
            <button type="button" class="button secondary" data-new-script>New template</button>
          </div>
          ${this.errorFor('script')}
          <small class="hint">The path is relative to the YAML file. Loaded code and drafts stay local to this browser.</small>
        </div>
        <div class="field wide script-editor-field">
          <span class="field-title-row">
            JavaScript editor
            <button type="button" class="button secondary compact-button" data-save-script>Save script</button>
          </span>
          <div class="script-editor" data-script-editor></div>
          <input type="file" data-script-file accept=".js,.cjs,text/javascript" hidden>
          <small class="hint">Export <code>module.exports = function (row, { lookup, lookupAll }) { ... }</code>. Saving writes directly when the browser permits it; otherwise it downloads the file.</small>
        </div>
      </div>`;
    }
    const fields = action.type === 'delete' ? '' : this.fieldsEditor(action);
    const output = action.type === 'insert'
      ? this.field('outputSheet', 'ID output sheet', action.outputSheet, { list: true, placeholder: 'Optional: Inserted IDs' })
      : '';
    const external = action.type === 'upsert'
      ? this.field('externalIdField', 'External ID field', action.externalIdField, { required: true, placeholder: 'External_Id__c' })
      : '';
    return `<div class="form-grid two">
      ${this.field('object', 'Salesforce object', action.object, { required: true, placeholder: 'Account' })}
      ${this.field('inputSheet', 'Input sheet', action.inputSheet, { required: true, list: true })}
      ${external}
      ${output}
      ${fields}
    </div>`;
  }

  fieldsEditor(action) {
    const locked = action.type === 'update' ? 'id' : action.type === 'upsert' ? action.externalIdField?.toLowerCase() : '';
    const knownFields = this.fieldsForSelectedSheet();
    const hasFields = (action.fields || []).length > 0;
    return `<div class="field wide">
      <span class="field-title-row">
        Fields
        <span class="field-title-actions">
          ${knownFields.length ? '<button type="button" class="text-button" data-use-sheet-fields>Use selected sheet fields</button>' : ''}
          ${hasFields ? '<button type="button" class="text-button danger-text" data-clear-fields>Clear fields</button>' : ''}
        </span>
      </span>
      <div class="chips">
        ${(action.fields || []).map((field, index) => `
          <span class="chip ${field.toLowerCase() === locked ? 'locked' : ''}">
            ${esc(field)}
            ${field.toLowerCase() === locked ? '<span title="Required">●</span>' : `<button type="button" data-remove-field="${index}" aria-label="Remove ${esc(field)}">×</button>`}
          </span>`).join('')}
        <input id="new-action-field" type="text" placeholder="Type a field, or paste CSV / Excel headers">
      </div>
      ${this.errorFor('fields')}
      <small class="hint">${hasFields
        ? action.type === 'update'
          ? 'Id is required and locked in an explicit field list.'
          : action.type === 'upsert'
            ? 'The external ID is required and locked in an explicit field list.'
            : 'Id is not allowed for INSERT.'
        : 'All input sheet fields will be used.'}</small>
    </div>`;
  }

  field(name, label, value, options = {}) {
    const attributes = [
      `data-field="${name}"`,
      options.required ? 'required' : '',
      options.placeholder ? `placeholder="${esc(options.placeholder)}"` : '',
      options.list ? 'list="sheet-suggestions"' : '',
      options.min !== undefined ? `min="${options.min}"` : '',
      options.type ? `type="${options.type}"` : 'type="text"',
    ].filter(Boolean).join(' ');
    const control = options.textarea
      ? `<textarea ${attributes} rows="5">${esc(value)}</textarea>`
      : `<input ${attributes} value="${esc(value)}">`;
    return `<label class="field ${options.wide ? 'wide' : ''}">
      <span>${label}${options.required ? ' <b>*</b>' : ''}</span>
      ${control}
      ${this.errorFor(name)}
    </label>`;
  }

  errorFor(name) {
    return this.errors[name] ? `<small class="field-error">${this.errors[name].join(' · ')}</small>` : '';
  }

  bind() {
    this.querySelectorAll('[data-close]').forEach(element => element.addEventListener('click', event => {
      if (event.target === element || element.matches('button')) this.close();
    }));
    this.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      this.sync();
      this.commitPendingField();
      ensureIdentifierField(this.draft);
      const issues = validateActionDraft(this.draft, this.otherActions);
      this.errors = issuesByField(issues);
      if (issues.length) {
        this.errors.action = ['Please correct the highlighted fields.'];
        this.render();
        return;
      }
      this.dispatchEvent(new CustomEvent('action-save', {
        detail: { action: this.draft, index: this.index },
        bubbles: true,
      }));
      this.close();
    });
    this.querySelector('[data-field="type"]').addEventListener('change', event => {
      this.sync();
      this.draft = changeActionType(this.draft, event.target.value);
      if (this.draft.type === 'transform' && !this.draft.script && !this.draft.scriptContent) {
        this.draft.script = './transform.js';
        this.draft.scriptContent = this.transformTemplate();
      }
      this.errors = {};
      this.render();
    });
    this.querySelector('[data-field="externalIdField"]')?.addEventListener('change', () => {
      this.sync();
      ensureIdentifierField(this.draft);
      this.render();
    });
    this.querySelector('[data-field="inputSheet"]')?.addEventListener('change', () => {
      this.sync();
      if (!['insert', 'update', 'upsert'].includes(this.draft.type)) return;
      const knownFields = this.fieldsForSelectedSheet();
      const identifier = this.draft.type === 'update'
        ? 'id'
        : this.draft.type === 'upsert'
          ? this.draft.externalIdField?.toLowerCase()
          : '';
      const userFields = (this.draft.fields || []).filter(field => field.toLowerCase() !== identifier);
      if (knownFields.length && userFields.length === 0) {
        this.applySheetFields();
        this.render();
      }
    });
    this.querySelector('[data-use-sheet-fields]')?.addEventListener('click', () => {
      this.sync();
      this.applySheetFields();
      this.render();
    });
    this.querySelector('[data-clear-fields]')?.addEventListener('click', () => {
      this.sync();
      this.draft.fields = [];
      delete this.errors.fields;
      this.render();
    });
    this.querySelector('[data-load-script]')?.addEventListener('click', () => this.chooseScriptFile());
    this.querySelector('[data-script-file]')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) this.loadScriptFile(file);
      event.target.value = '';
    });
    this.querySelector('[data-new-script]')?.addEventListener('click', () => {
      this.sync();
      this.scriptFileHandle = null;
      if (!this.draft.script.trim()) this.draft.script = './transform.js';
      this.draft.scriptContent = this.transformTemplate();
      this.render();
    });
    this.querySelector('[data-save-script]')?.addEventListener('click', () => this.saveScriptFile());
    this.querySelectorAll('[data-remove-field]').forEach(button => button.addEventListener('click', () => {
      this.sync();
      this.draft.fields.splice(Number(button.dataset.removeField), 1);
      this.render();
    }));
    this.querySelector('#new-action-field')?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ',') return;
      event.preventDefault();
      this.sync();
      this.commitPendingField();
      this.render();
    });
    this.querySelector('#new-action-field')?.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text') || '';
      if (!text.trim()) return;
      event.preventDefault();
      this.sync();
      this.addFieldsFromText(text);
      this.render();
    });
  }

  commitPendingField() {
    const input = this.querySelector('#new-action-field');
    const field = input?.value.trim();
    if (!field) return;
    this.addFieldsFromText(field, false);
    if (input) input.value = '';
  }

  addFieldsFromText(text, announce = true) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      if (announce) toast('No field headers were found in the clipboard.', 'error');
      return;
    }
    const delimiter = trimmed.includes('\t')
      ? '\t'
      : trimmed.includes(',')
        ? ','
        : trimmed.includes(';')
          ? ';'
          : null;
    const values = delimiter
      ? Papa.parse(trimmed, { delimiter, skipEmptyLines: true }).data.flat()
      : trimmed.split(/\r?\n/);
    const candidates = values
      .map(value => String(value ?? '').replace(/^\uFEFF/, '').trim())
      .filter(Boolean);
    const existing = new Set((this.draft.fields || []).map(field => field.toLowerCase()));
    let added = 0;
    let skippedId = false;
    for (const field of candidates) {
      const key = field.toLowerCase();
      if (this.draft.type === 'insert' && key === 'id') {
        skippedId = true;
        continue;
      }
      if (existing.has(key)) continue;
      this.draft.fields.push(field);
      existing.add(key);
      added++;
    }
    ensureIdentifierField(this.draft);
    if (skippedId) {
      this.errors.fields = ['Id was skipped because explicit INSERT field lists cannot contain Id.'];
    } else {
      delete this.errors.fields;
    }
    if (announce) {
      toast(`${added} field${added === 1 ? '' : 's'} added from copied headers`);
    }
  }

  initializeScriptEditor() {
    const parent = this.querySelector('[data-script-editor]');
    if (!parent || this.draft.type !== 'transform') return;
    this.scriptEditor = new EditorView({
      doc: this.draft.scriptContent || '',
      extensions: [
        basicSetup,
        javascript({ commonjs: true }),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          keydown: event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              this.saveScriptFile();
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) this.draft.scriptContent = update.state.doc.toString();
        }),
      ],
      parent,
    });
  }

  transformTemplate() {
    const fields = this.fieldsForSelectedSheet()
      .map(field => field.replace(/\*\//g, '* /'));
    const fieldComment = fields.length
      ? ` * Input fields: ${fields.join(', ')}\n`
      : ' * Select a known input sheet to document its fields here.\n';
    return `/**
 * Transform one input row. Return null to omit it.
${fieldComment} */
module.exports = function transform(row, { lookup, lookupAll }) {
  // Example lookup:
  // const match = lookup('Other Sheet', 'Id', row.RelatedId);
  // row.RelatedName = match ? match.Name : '';

  // Add, update, or delete row fields here.
  return row;
};
`;
  }

  async chooseScriptFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'CommonJS JavaScript',
            accept: { 'text/javascript': ['.js', '.cjs'] },
          }],
          multiple: false,
        });
        if (!handle) return;
        await this.loadScriptFile(await handle.getFile(), handle);
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    this.querySelector('[data-script-file]')?.click();
  }

  async loadScriptFile(file, handle = null) {
    try {
      this.sync();
      this.scriptFileHandle = handle;
      this.draft.script = `./${file.name}`;
      this.draft.scriptContent = await file.text();
      this.render();
      toast(`Loaded ${file.name}`);
    } catch (error) {
      toast(`Could not load script: ${error.message}`, 'error', 6000);
    }
  }

  async saveScriptFile() {
    this.sync();
    const content = this.scriptEditor?.state.doc.toString() ?? this.draft.scriptContent ?? '';
    if (!content.trim()) {
      toast('Write or load JavaScript before saving.', 'error');
      return;
    }
    this.draft.scriptContent = content;
    const suggestedName = this.draft.script.split(/[\\/]/).pop() || 'transform.js';
    try {
      let handle = this.scriptFileHandle;
      if (!handle && window.showSaveFilePicker) {
        handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{
            description: 'CommonJS JavaScript',
            accept: { 'text/javascript': ['.js', '.cjs'] },
          }],
        });
      }
      if (handle?.createWritable) {
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        this.scriptFileHandle = handle;
        toast(`Saved ${handle.name}`);
        return;
      }
      this.downloadScript(content, suggestedName);
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.downloadScript(content, suggestedName);
      }
    }
  }

  downloadScript(content, fileName) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/javascript' }));
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    toast(`Downloaded ${fileName}`);
  }

  fieldsForSelectedSheet() {
    const inputName = this.draft?.inputSheet?.trim().toLowerCase();
    return this.sheetCatalog.find(sheet => sheet.name.toLowerCase() === inputName)?.fields || [];
  }

  applySheetFields() {
    let fields = [...this.fieldsForSelectedSheet()];
    if (this.draft.type === 'insert') fields = fields.filter(field => field.toLowerCase() !== 'id');
    this.draft.fields = fields;
    ensureIdentifierField(this.draft);
  }

  sync() {
    this.querySelectorAll('[data-field]').forEach(input => {
      const name = input.dataset.field;
      this.draft[name] = input.type === 'checkbox'
        ? input.checked
        : input.type === 'number'
          ? Number(input.value || 0)
          : input.value;
    });
  }
}

customElements.define('sf-action-modal', SfActionModal);
