'use strict';

import { bus } from '../state.js';
import { refreshYaml, downloadYaml, copyYaml, importFile, handleDrop, importText } from '../yaml.js';

class SfIoPanel extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section id="tab-io" class="tab-section">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <!-- Export -->
          <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 class="font-bold text-slate-800 text-sm">Export Configuration</h2>
              <div class="flex gap-2">
                <button data-action="copy" class="btn-secondary text-xs py-1 px-3">Copy</button>
                <button data-action="download" class="btn-primary text-xs py-1 px-3">⬇ Download .yaml</button>
              </div>
            </div>
            <pre id="yaml-preview"># Click "Refresh Preview" or "Generate YAML" to update.</pre>
            <div class="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <button data-action="refresh" class="text-indigo-600 hover:text-indigo-800 text-xs font-semibold">↺ Refresh Preview</button>
              <span class="text-[10px] text-slate-400">Generated with js-yaml</span>
            </div>
          </div>

          <!-- Import -->
          <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h2 class="font-bold text-slate-800 text-sm">Import Configuration</h2>
              <p class="text-[11px] text-slate-400 mt-0.5">Loading a config replaces the current configuration.</p>
            </div>
            <div class="p-4 space-y-4">
              <div id="drop-zone"
                class="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center transition">
                <svg class="mx-auto mb-2 w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <p class="text-xs text-slate-500">Drop a <code class="bg-slate-100 px-1 rounded">.yaml</code> file here, or</p>
                <button data-action="choose-file" class="mt-2 btn-primary text-xs py-1.5 px-4">Choose File</button>
                <input type="file" id="yaml-file-input" accept=".yaml,.yml" class="hidden">
              </div>
              <div class="flex items-center gap-2">
                <span class="h-px flex-1 bg-slate-100"></span>
                <span class="text-[10px] text-slate-400 uppercase tracking-wide">or paste YAML text</span>
                <span class="h-px flex-1 bg-slate-100"></span>
              </div>
              <div>
                <textarea id="yaml-text-input" class="field-input text-xs font-mono h-36" placeholder="Paste your YAML configuration here..."></textarea>
                <button data-action="load-text" class="mt-2 btn-primary text-xs py-1.5 w-full justify-center">Load from Text</button>
              </div>
            </div>
          </div>

        </div>
      </section>`;

    this.querySelector('[data-action="copy"]').addEventListener('click', () => copyYaml());
    this.querySelector('[data-action="download"]').addEventListener('click', () => downloadYaml());
    this.querySelector('[data-action="refresh"]').addEventListener('click', () => refreshYaml());
    this.querySelector('[data-action="load-text"]').addEventListener('click', () => importText());
    this.querySelector('[data-action="choose-file"]').addEventListener('click', () =>
      document.getElementById('yaml-file-input').click()
    );

    document.addEventListener('change', e => {
      if (e.target.id === 'yaml-file-input') importFile(e.target.files[0]);
    });

    const dropZone = this.querySelector('#drop-zone');
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleDrop(e);
    });

    bus.on('tab-switch', name => {
      this.querySelector('section').classList.toggle('active', name === 'io');
      if (name === 'io') refreshYaml();
    });

    bus.on('generate-yaml', () => {
      refreshYaml();
      bus.emit('tab-switch', 'io');
    });
  }
}

customElements.define('sf-io-panel', SfIoPanel);
