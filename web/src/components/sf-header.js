'use strict';

import { bus } from '../state.js';

class SfHeader extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header class="bg-slate-900 shadow-lg">
        <div class="max-w-screen-xl mx-auto px-5 py-2.5 flex items-center justify-between gap-4">
          <div class="flex items-center gap-2.5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/>
              <path d="M16 2H8l-2 5h12Z"/>
            </svg>
            <span class="text-white font-bold tracking-tight text-base">SF Data · Config Generator</span>
          </div>
          <div class="flex items-center gap-2">
            <button data-action="go-io" class="text-slate-300 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-700 transition">
              Import / Export
            </button>
            <button data-action="generate-yaml" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-1.5 rounded-lg transition">
              ↓ Generate YAML
            </button>
          </div>
        </div>
      </header>`;

    this.querySelector('[data-action="go-io"]').addEventListener('click', () => bus.emit('tab-switch', 'io'));
    this.querySelector('[data-action="generate-yaml"]').addEventListener('click', () => bus.emit('generate-yaml'));
  }
}

customElements.define('sf-header', SfHeader);
