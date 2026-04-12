'use strict';

import { state, uid, bus } from './state.js';
import { esc } from './utils.js';

export function addSheet(data = {}) {
  const sheet = {
    id: uid(),
    name: data.name || '',
    fields: (data.fields || []).map(f => ({ id: uid(), name: f.name || '', apiName: f.apiName || '' })),
  };
  state.sheets.push(sheet);
  bus.emit('sheets-changed');
  if (!data.name) {
    setTimeout(() => {
      const el = document.getElementById(`sname-${sheet.id}`);
      if (el) {
        el.focus();
        document.getElementById(`sfields-${sheet.id}`)?.classList.remove('hidden');
      }
    }, 30);
  }
}

export function removeSheet(id) {
  state.sheets = state.sheets.filter(s => s.id !== id);
  bus.emit('sheets-changed');
}

export function addSheetField(sheetId) {
  syncSheets();
  const s = state.sheets.find(s => s.id === sheetId);
  if (s) {
    s.fields.push({ id: uid(), name: '', apiName: '' });
    bus.emit('sheets-changed');
  }
  setTimeout(() => document.getElementById(`sfields-${sheetId}`)?.classList.remove('hidden'), 20);
}

export function removeSheetField(sheetId, fid) {
  syncSheets();
  const s = state.sheets.find(s => s.id === sheetId);
  if (s) {
    s.fields = s.fields.filter(f => f.id !== fid);
    bus.emit('sheets-changed');
  }
}

export function syncSheets() {
  state.sheets.forEach(sheet => {
    const el = document.getElementById(`sname-${sheet.id}`);
    if (el) sheet.name = el.value;
    sheet.fields.forEach(f => {
      const ne = document.getElementById(`fname-${f.id}`);
      const ae = document.getElementById(`fapi-${f.id}`);
      if (ne) f.name = ne.value;
      if (ae) f.apiName = ae.value;
    });
  });
}

export function toggleSheetFields(id) {
  syncSheets();
  document.getElementById(`sfields-${id}`)?.classList.toggle('hidden');
}

export function renderSheets() {
  const list  = document.getElementById('sheets-list');
  const empty = document.getElementById('sheets-empty');
  if (!list || !empty) return;

  document.getElementById('badge-sheets').textContent = state.sheets.length;

  if (!state.sheets.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = state.sheets.map(sheet => `
    <div class="sheet-row" id="srow-${sheet.id}">
      <div class="grid grid-cols-[2fr_100px_100px] gap-2 px-4 py-2.5 items-center hover:bg-slate-50 transition">
        <input id="sname-${sheet.id}" type="text" class="field-input font-medium"
          value="${esc(sheet.name)}" placeholder="e.g. accounts" onchange="window._sfApp.syncSheets()">
        <button onclick="window._sfApp.toggleSheetFields('${sheet.id}')"
          class="text-xs font-medium text-left text-slate-500 hover:text-indigo-600 transition px-1">
          ${sheet.fields.length} field${sheet.fields.length !== 1 ? 's' : ''}
          <span class="text-slate-300">${sheet.fields.length ? '▾' : '+'}</span>
        </button>
        <div class="flex items-center justify-end gap-2">
          <button onclick="window._sfApp.addSheetField('${sheet.id}')" class="text-[11px] text-emerald-600 hover:text-emerald-800 font-bold" title="Add field">+Field</button>
          <button onclick="window._sfApp.removeSheet('${sheet.id}')" title="Remove sheet"
            class="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-slate-300 hover:text-red-500 text-base">×</button>
        </div>
      </div>
      <div id="sfields-${sheet.id}" class="${sheet.fields.length ? '' : 'hidden'} bg-slate-50 border-t border-slate-100 px-4 pt-2 pb-3">
        ${sheet.fields.length ? `
        <table class="w-full text-xs mb-1.5">
          <thead>
            <tr class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <th class="text-left py-1.5 pr-3">Column Name in File</th>
              <th class="text-left py-1.5 pr-3">Salesforce API Name</th>
              <th class="w-6"></th>
            </tr>
          </thead>
          <tbody>
            ${sheet.fields.map(f => `
            <tr>
              <td class="pr-3 py-1"><input id="fname-${f.id}" type="text" class="field-input-xs" value="${esc(f.name)}" placeholder="Human Label" onchange="window._sfApp.syncSheets()"></td>
              <td class="pr-3 py-1"><input id="fapi-${f.id}" type="text" class="field-input-xs font-mono" value="${esc(f.apiName)}" placeholder="SF_Field__c" onchange="window._sfApp.syncSheets()"></td>
              <td class="py-1"><button onclick="window._sfApp.removeSheetField('${sheet.id}','${f.id}')" class="w-5 h-5 flex items-center justify-center rounded hover:bg-red-50 text-slate-300 hover:text-red-500">×</button></td>
            </tr>`).join('')}
          </tbody>
        </table>` : `<p class="text-xs text-slate-400 mb-1.5">No fields.</p>`}
        <button onclick="window._sfApp.addSheetField('${sheet.id}')" class="text-[11px] text-emerald-600 hover:text-emerald-800 font-bold">+ Add field</button>
      </div>
    </div>
  `).join('');
}
