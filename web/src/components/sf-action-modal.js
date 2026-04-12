'use strict';

import { bus } from '../state.js';
import {
  openModal, closeModal, saveModal,
  addRow, updRow, delRow,
  toggleSubBody, onToggleSub, updImportBadge,
} from '../modal.js';

class SfActionModal extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div id="action-modal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 items-start justify-center overflow-y-auto p-4">
        <div class="bg-white rounded-2xl w-full max-w-2xl shadow-2xl my-4 flex flex-col">

          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
            <div>
              <h3 id="modal-title" class="font-bold text-slate-900 text-base">Edit Action</h3>
              <p class="text-[11px] text-slate-400 mt-0.5">Toggle each sub-step to enable or disable it</p>
            </div>
            <button data-action="close" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 text-lg">×</button>
          </div>

          <!-- Body -->
          <div class="overflow-y-auto flex-1 px-5 py-4 space-y-3">

            <div class="grid grid-cols-2 gap-3">
              <div class="col-span-2 sm:col-span-1">
                <label class="field-label">Action Name *</label>
                <input id="m-name" type="text" class="field-input" placeholder="e.g. Insert Accounts">
              </div>
              <div>
                <label class="field-label">Wait Before Start (s)</label>
                <input id="m-wait" type="number" value="0" min="0" class="field-input">
              </div>
              <div>
                <label class="field-label">Input Sheet</label>
                <input id="m-in" type="text" class="field-input" placeholder="e.g. accounts">
              </div>
              <div>
                <label class="field-label">Output Sheet <span class="font-normal normal-case text-slate-400">(defaults to input)</span></label>
                <input id="m-out" type="text" class="field-input" placeholder="same as input">
              </div>
            </div>

            <!-- COPY SHEET -->
            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="subaction-header bg-violet-50" data-toggle="copy">
                <div class="flex items-center gap-2">
                  <span class="badge badge-copy">COPY SHEET</span>
                  <span class="text-xs text-slate-600">Filter &amp; copy columns to another sheet</span>
                </div>
                <label class="toggle-wrap" onclick="event.stopPropagation()">
                  <input type="checkbox" id="m-copy-on" data-toggle-sub="copy">
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div id="sub-copy" class="hidden subaction-body space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="field-label">Condition <span class="font-normal normal-case text-slate-400">(JS expression, optional)</span></label>
                    <input id="m-copy-cond" type="text" class="field-input font-mono text-xs" placeholder="'\${IsActive}' === 'true'">
                  </div>
                  <div>
                    <label class="field-label">Unique Field <span class="font-normal normal-case text-slate-400">(for merging)</span></label>
                    <input id="m-copy-uniq" type="text" class="field-input" placeholder="Name">
                  </div>
                </div>
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <label class="field-label mb-0">Copy Fields <span class="font-normal normal-case text-slate-400">(empty = copy all)</span></label>
                    <button data-add-row="copy-fields:copy-row" class="text-[11px] text-violet-600 hover:text-violet-800 font-bold">+ Add field</button>
                  </div>
                  <div class="border border-slate-200 rounded-lg overflow-hidden">
                    <table class="w-full text-xs">
                      <thead class="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th class="text-left px-3 py-2">Source Column Name</th>
                          <th class="text-left px-3 py-2">API Name (dest)</th>
                          <th class="w-7"></th>
                        </tr>
                      </thead>
                      <tbody id="copy-fields"></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- EXPORT -->
            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="subaction-header bg-blue-50" data-toggle="export">
                <div class="flex items-center gap-2">
                  <span class="badge badge-export">EXPORT</span>
                  <span class="text-xs text-slate-600">SOQL query → merge into sheet</span>
                </div>
                <label class="toggle-wrap" onclick="event.stopPropagation()">
                  <input type="checkbox" id="m-export-on" data-toggle-sub="export">
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div id="sub-export" class="hidden subaction-body space-y-3">
                <div>
                  <label class="field-label">SOQL Query *</label>
                  <textarea id="m-export-q" class="field-input text-xs font-mono h-16" placeholder="SELECT Id, Name FROM Account WHERE IsActive = true ORDER BY Name"></textarea>
                </div>
                <div>
                  <label class="field-label">Unique Field <span class="font-normal normal-case text-slate-400">(column used to merge results into the sheet)</span></label>
                  <input id="m-export-uniq" type="text" class="field-input" placeholder="Name">
                </div>
              </div>
            </div>

            <!-- TRANSFORM -->
            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="subaction-header bg-amber-50" data-toggle="transform">
                <div class="flex items-center gap-2">
                  <span class="badge badge-transform">TRANSFORM</span>
                  <span class="text-xs text-slate-600">Compute field values with JS expressions</span>
                </div>
                <label class="toggle-wrap" onclick="event.stopPropagation()">
                  <input type="checkbox" id="m-transform-on" data-toggle-sub="transform">
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div id="sub-transform" class="hidden subaction-body">
                <div class="flex items-center justify-between mb-1.5">
                  <label class="field-label mb-0">Field Transformations</label>
                  <button data-add-row="tf-fields:tf-row" class="text-[11px] text-amber-600 hover:text-amber-800 font-bold">+ Add field</button>
                </div>
                <div class="border border-slate-200 rounded-lg overflow-hidden">
                  <table class="w-full text-xs">
                    <thead class="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <tr>
                        <th class="text-left px-3 py-2 w-2/5">API Field Name</th>
                        <th class="text-left px-3 py-2">Transformation Expression</th>
                        <th class="w-7"></th>
                      </tr>
                    </thead>
                    <tbody id="tf-fields"></tbody>
                  </table>
                </div>
                <p class="text-[10px] text-slate-400 mt-2">
                  <code class="bg-slate-100 px-1 rounded">\${Field}</code> = row value &emsp;
                  <code class="bg-slate-100 px-1 rounded">\${Sheet.Match.Target}</code> = cross-sheet lookup &emsp;
                  Full JS: <code class="bg-slate-100 px-1 rounded">Number(), Math.*, Date.now()</code>
                </p>
              </div>
            </div>

            <!-- IMPORT -->
            <div class="border border-slate-200 rounded-xl overflow-hidden">
              <div class="subaction-header bg-green-50" data-toggle="import">
                <div class="flex items-center gap-2">
                  <span id="m-import-badge" class="badge badge-insert">INSERT</span>
                  <span class="text-xs text-slate-600">Send sheet data to Salesforce</span>
                </div>
                <label class="toggle-wrap" onclick="event.stopPropagation()">
                  <input type="checkbox" id="m-import-on" data-toggle-sub="import">
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div id="sub-import" class="hidden subaction-body space-y-3">
                <div class="grid grid-cols-3 gap-3">
                  <div>
                    <label class="field-label">Salesforce Object *</label>
                    <input id="m-import-obj" type="text" class="field-input" placeholder="Account">
                  </div>
                  <div>
                    <label class="field-label">Action *</label>
                    <select id="m-import-action" class="field-input" data-action="update-import-badge">
                      <option value="insert">insert</option>
                      <option value="update">update</option>
                      <option value="upsert">upsert</option>
                      <option value="delete">delete</option>
                    </select>
                  </div>
                  <div>
                    <label class="field-label">Unique Field <span class="text-slate-400 font-normal">(optional)</span></label>
                    <input id="m-import-uniq" type="text" class="field-input" placeholder="Name">
                  </div>
                </div>
                <div>
                  <label class="field-label">Import Fields <span class="font-normal normal-case text-slate-400">(one per line — leave empty to send all columns)</span></label>
                  <textarea id="m-import-fields" class="field-input h-28 font-mono text-xs" placeholder="Name&#10;BillingCity&#10;BillingCountry&#10;Phone&#10;Industry"></textarea>
                </div>
              </div>
            </div>

          </div><!-- /body -->

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 flex-shrink-0">
            <button data-action="close" class="btn-secondary text-xs py-1.5 px-4">Cancel</button>
            <button data-action="save" class="btn-primary text-xs py-1.5 px-6">Save Action</button>
          </div>
        </div>
      </div>`;

    this.querySelectorAll('[data-action="close"]').forEach(btn =>
      btn.addEventListener('click', () => closeModal())
    );
    this.querySelector('[data-action="save"]').addEventListener('click', () => saveModal());

    this.querySelectorAll('[data-toggle]').forEach(header => {
      header.addEventListener('click', () => toggleSubBody(header.dataset.toggle));
    });

    this.querySelectorAll('[data-toggle-sub]').forEach(checkbox => {
      checkbox.addEventListener('change', () => onToggleSub(checkbox.dataset.toggleSub, checkbox.checked));
    });

    this.querySelector('[data-action="update-import-badge"]').addEventListener('change', () => updImportBadge());

    this.querySelectorAll('[data-add-row]').forEach(btn => {
      const [tbodyId, typeHint] = btn.dataset.addRow.split(':');
      btn.addEventListener('click', () => addRow(tbodyId, typeHint));
    });

    document.getElementById('action-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal();
    });

    bus.on('modal-open', id => openModal(id));

    // Expose to window for inline SVG onclick handlers
    window._sfApp = window._sfApp || {};
    window._sfApp.openModal = openModal;
  }
}

customElements.define('sf-action-modal', SfActionModal);
