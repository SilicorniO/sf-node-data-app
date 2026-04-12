'use strict';

import { bus } from '../state.js';

class SfConfigPanel extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section id="tab-config" class="tab-section active">
        <div class="bg-white rounded-xl border border-slate-200 p-5">
          <h2 class="font-bold text-slate-800 mb-4 text-sm">App Configuration</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            <div>
              <label class="field-label">Processing Type</label>
              <select id="cfg-processingType" class="field-input">
                <option value="bulk">bulk (Bulk API v2)</option>
                <option value="api">api (sObject Collections)</option>
              </select>
            </div>
            <div>
              <label class="field-label">Max Wait (s)</label>
              <input type="number" id="cfg-maxWait" value="300" min="0" class="field-input">
            </div>
            <div>
              <label class="field-label">Poll Interval (s)</label>
              <input type="number" id="cfg-pollInterval" value="5" min="1" class="field-input">
            </div>
            <div>
              <label class="field-label">API Version</label>
              <input type="text" id="cfg-apiVersion" value="63.0" class="field-input">
            </div>
            <label class="toggle-wrap pb-1">
              <input type="checkbox" id="cfg-stopOnError" checked>
              <span class="toggle-track"></span>
              <span class="text-xs font-semibold text-slate-600">Stop on Error</span>
            </label>
            <label class="toggle-wrap pb-1">
              <input type="checkbox" id="cfg-rollbackOnError">
              <span class="toggle-track"></span>
              <span class="text-xs font-semibold text-slate-600">Rollback on Error</span>
            </label>
          </div>
          <p class="mt-4 text-[11px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
            <strong>bulk</strong> — Bulk API v2, async, ideal for &gt;200 records.&ensp;
            <strong>api</strong> — sObject Collections, sync, up to 200 records/batch.&ensp;
            <strong>Rollback</strong> auto-deletes inserted records if a later action fails (requires Stop on Error).
          </p>
        </div>
      </section>`;

    bus.on('tab-switch', name => {
      this.querySelector('section').classList.toggle('active', name === 'config');
    });
  }
}

customElements.define('sf-config-panel', SfConfigPanel);
