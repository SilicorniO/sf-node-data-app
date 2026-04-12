'use strict';

import { state, uid, bus } from './state.js';
import { esc } from './utils.js';
import { toast } from './utils.js';
import { renderActions, renderDiagram, getView } from './actions.js';

let _editId   = null;
let _copyRows = [];
let _tfRows   = [];

export function addRow(tbodyId, typeHint) {
  const tb = document.getElementById(tbodyId);
  const id = uid();
  const tr = document.createElement('tr');
  tr.id = `row-${id}`;
  if (typeHint === 'copy-row') {
    tr.innerHTML = `
      <td class="px-3 py-1.5"><input type="text" class="field-input-xs" placeholder="SourceColumn" oninput="window._sfApp.updRow('copy','${id}','name',this.value)"></td>
      <td class="px-3 py-1.5"><input type="text" class="field-input-xs font-mono" placeholder="DestApiName" oninput="window._sfApp.updRow('copy','${id}','apiName',this.value)"></td>
      <td class="pr-3 py-1.5"><button onclick="window._sfApp.delRow('copy-fields','copy','${id}')" class="w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500">×</button></td>`;
    _copyRows.push({ id, name: '', apiName: '' });
  } else {
    tr.innerHTML = `
      <td class="px-3 py-1.5"><input type="text" class="field-input-xs font-mono" placeholder="AccountId" oninput="window._sfApp.updRow('tf','${id}','name',this.value)"></td>
      <td class="px-3 py-1.5"><input type="text" class="field-input-xs font-mono text-amber-700" placeholder="'\${Accounts.Name.Id}'" oninput="window._sfApp.updRow('tf','${id}','transformation',this.value)"></td>
      <td class="pr-3 py-1.5"><button onclick="window._sfApp.delRow('tf-fields','tf','${id}')" class="w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500">×</button></td>`;
    _tfRows.push({ id, name: '', transformation: '' });
  }
  tb.appendChild(tr);
}

export function updRow(arrKey, id, key, val) {
  const arr = arrKey === 'copy' ? _copyRows : _tfRows;
  const r = arr.find(r => r.id === id);
  if (r) r[key] = val;
}

export function delRow(tbodyId, arrKey, id) {
  const arr = arrKey === 'copy' ? _copyRows : _tfRows;
  const idx = arr.findIndex(r => r.id === id);
  if (idx !== -1) arr.splice(idx, 1);
  document.getElementById(`row-${id}`)?.remove();
}

function populateRows(tbodyId, typeHint, rows) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;
  tb.innerHTML = '';
  rows.forEach(r => {
    const id = uid();
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    if (typeHint === 'copy-row') {
      tr.innerHTML = `
        <td class="px-3 py-1.5"><input type="text" class="field-input-xs" value="${esc(r.name)}" placeholder="SourceColumn" oninput="window._sfApp.updRow('copy','${id}','name',this.value)"></td>
        <td class="px-3 py-1.5"><input type="text" class="field-input-xs font-mono" value="${esc(r.apiName)}" placeholder="DestApiName" oninput="window._sfApp.updRow('copy','${id}','apiName',this.value)"></td>
        <td class="pr-3 py-1.5"><button onclick="window._sfApp.delRow('copy-fields','copy','${id}')" class="w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500">×</button></td>`;
      _copyRows.push({ id, name: r.name, apiName: r.apiName });
    } else {
      tr.innerHTML = `
        <td class="px-3 py-1.5"><input type="text" class="field-input-xs font-mono" value="${esc(r.name)}" placeholder="AccountId" oninput="window._sfApp.updRow('tf','${id}','name',this.value)"></td>
        <td class="px-3 py-1.5"><input type="text" class="field-input-xs font-mono text-amber-700" value="${esc(r.transformation)}" placeholder="'\${Accounts.Name.Id}'" oninput="window._sfApp.updRow('tf','${id}','transformation',this.value)"></td>
        <td class="pr-3 py-1.5"><button onclick="window._sfApp.delRow('tf-fields','tf','${id}')" class="w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 text-slate-400 hover:text-red-500">×</button></td>`;
      _tfRows.push({ id, name: r.name, transformation: r.transformation });
    }
    tb.appendChild(tr);
  });
}

export function toggleSubBody(type) {
  document.getElementById(`sub-${type}`)?.classList.toggle('hidden');
}

export function onToggleSub(type, on) {
  document.getElementById(`sub-${type}`)?.classList.toggle('hidden', !on);
}

export function updImportBadge() {
  const v = document.getElementById('m-import-action')?.value || 'insert';
  const b = document.getElementById('m-import-badge');
  if (b) { b.textContent = v.toUpperCase(); b.className = `badge badge-${v}`; }
}

export function openModal(id) {
  _editId = id;
  const a = state.actions.find(a => a.id === id);
  if (!a) return;

  const idx = state.actions.indexOf(a);
  document.getElementById('modal-title').textContent = `Action #${idx + 1}${a.name ? ' — ' + a.name : ''}`;

  document.getElementById('m-name').value = a.name || '';
  document.getElementById('m-wait').value = a.waitStartingTime || 0;
  document.getElementById('m-in').value   = a.inputSheet || '';
  document.getElementById('m-out').value  = a.outputSheet || '';

  const hasCopy = !!a.copySheetAction;
  document.getElementById('m-copy-on').checked = hasCopy;
  document.getElementById('sub-copy').classList.toggle('hidden', !hasCopy);
  document.getElementById('m-copy-cond').value = (a.copySheetAction?.condition || '');
  document.getElementById('m-copy-uniq').value = (a.copySheetAction?.uniqueField || '');
  _copyRows = [];
  populateRows('copy-fields', 'copy-row', a.copySheetAction?.copyFields || []);

  const hasExport = !!a.exportAction;
  document.getElementById('m-export-on').checked = hasExport;
  document.getElementById('sub-export').classList.toggle('hidden', !hasExport);
  document.getElementById('m-export-q').value    = (a.exportAction?.query || '');
  document.getElementById('m-export-uniq').value = (a.exportAction?.uniqueField || '');

  const hasTransform = !!a.transformAction;
  document.getElementById('m-transform-on').checked = hasTransform;
  document.getElementById('sub-transform').classList.toggle('hidden', !hasTransform);
  _tfRows = [];
  populateRows('tf-fields', 'tf-row', a.transformAction?.fieldsConf || []);

  const hasImport = !!a.importAction;
  document.getElementById('m-import-on').checked    = hasImport;
  document.getElementById('sub-import').classList.toggle('hidden', !hasImport);
  document.getElementById('m-import-obj').value     = (a.importAction?.objectName || '');
  document.getElementById('m-import-action').value  = (a.importAction?.action || 'insert');
  document.getElementById('m-import-uniq').value    = (a.importAction?.uniqueField || '');
  document.getElementById('m-import-fields').value  = (a.importAction?.importFields || []).join('\n');
  updImportBadge();

  document.getElementById('action-modal').classList.add('open');
  setTimeout(() => document.getElementById('m-name').focus(), 60);
}

export function closeModal() {
  document.getElementById('action-modal').classList.remove('open');
  _editId = null;
}

export function saveModal() {
  if (!_editId) return;
  const a = state.actions.find(a => a.id === _editId);
  if (!a) return;

  a.name             = document.getElementById('m-name').value.trim();
  a.waitStartingTime = parseInt(document.getElementById('m-wait').value) || 0;
  a.inputSheet       = document.getElementById('m-in').value.trim();
  a.outputSheet      = document.getElementById('m-out').value.trim();

  if (document.getElementById('m-copy-on').checked) {
    a.copySheetAction = {
      condition:   document.getElementById('m-copy-cond').value.trim() || undefined,
      uniqueField: document.getElementById('m-copy-uniq').value.trim() || undefined,
      copyFields:  _copyRows.filter(r => r.name).map(r => ({ name: r.name, apiName: r.apiName || r.name })),
    };
    if (!a.copySheetAction.copyFields.length) delete a.copySheetAction.copyFields;
  } else { a.copySheetAction = null; }

  if (document.getElementById('m-export-on').checked) {
    a.exportAction = {
      query:       document.getElementById('m-export-q').value.trim(),
      uniqueField: document.getElementById('m-export-uniq').value.trim() || undefined,
    };
  } else { a.exportAction = null; }

  if (document.getElementById('m-transform-on').checked) {
    const fields = _tfRows.filter(r => r.name).map(r => ({ name: r.name, transformation: r.transformation }));
    a.transformAction = fields.length ? { fieldsConf: fields } : null;
  } else { a.transformAction = null; }

  if (document.getElementById('m-import-on').checked) {
    const rawFields    = document.getElementById('m-import-fields').value;
    const importFields = rawFields.split('\n').map(s => s.trim()).filter(Boolean);
    a.importAction = {
      objectName:   document.getElementById('m-import-obj').value.trim(),
      action:       document.getElementById('m-import-action').value,
      uniqueField:  document.getElementById('m-import-uniq').value.trim() || undefined,
      importFields: importFields.length ? importFields : undefined,
    };
  } else { a.importAction = null; }

  renderActions();
  if (getView() === 'diagram') renderDiagram();
  closeModal();
  toast(`Action "${a.name || 'Unnamed'}" saved`);
}
