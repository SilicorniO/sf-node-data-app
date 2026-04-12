'use strict';

import { bus } from '../state.js';
import { addSheet, renderSheets } from '../sheets.js';

class SfSheetsPanel extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section id="tab-sheets" class="tab-section">
        <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h2 class="font-bold text-slate-800 text-sm">Sheets</h2>
            <button data-action="add-sheet" class="btn-primary text-xs py-1.5 px-3">+ Add Sheet</button>
          </div>
          <div class="grid grid-cols-[2fr_100px_100px] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <span>Sheet Name <span class="font-normal normal-case">(must match Excel tab or CSV filename)</span></span>
            <span>Fields</span>
            <span></span>
          </div>
          <div id="sheets-list"></div>
          <div id="sheets-empty" class="py-12 text-center text-slate-400 text-xs">
            No sheets configured.
            <button data-action="add-sheet-empty" class="text-indigo-500 hover:text-indigo-700 font-semibold ml-1">Add one</button>
          </div>
        </div>
      </section>`;

    this.querySelector('[data-action="add-sheet"]').addEventListener('click', () => addSheet());
    this.querySelector('[data-action="add-sheet-empty"]').addEventListener('click', () => addSheet());

    bus.on('tab-switch', name => {
      this.querySelector('section').classList.toggle('active', name === 'sheets');
    });

    bus.on('sheets-changed', () => renderSheets());
  }
}

customElements.define('sf-sheets-panel', SfSheetsPanel);
