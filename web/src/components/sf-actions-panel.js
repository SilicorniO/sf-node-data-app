'use strict';

import { bus } from '../state.js';
import { addAction, renderActions, renderDiagram, dZoom, dFit, setView } from '../actions.js';

class SfActionsPanel extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <section id="tab-actions" class="tab-section">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-1 p-0.5 bg-white border border-slate-200 rounded-lg">
            <button id="view-list-btn" class="view-btn active" data-view="list">☰ List</button>
            <button id="view-diagram-btn" class="view-btn" data-view="diagram">◈ Diagram</button>
          </div>
          <button data-action="add-action" class="btn-primary text-xs py-1.5 px-3">+ Add Action</button>
        </div>

        <!-- List view -->
        <div id="view-list">
          <div id="actions-list" class="space-y-2"></div>
          <div id="actions-empty" class="bg-white rounded-xl border border-slate-200 py-12 text-center text-slate-400 text-xs">
            No actions configured.
            <button data-action="add-action-empty" class="text-indigo-500 hover:text-indigo-700 font-semibold ml-1">Add one</button>
          </div>
        </div>

        <!-- Diagram view -->
        <div id="view-diagram" class="hidden">
          <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100 text-[11px]">
              <span class="text-slate-400">Click any action to edit &nbsp;·&nbsp; Scroll to zoom</span>
              <div class="flex gap-3">
                <button data-action="fit" class="text-slate-600 hover:text-slate-900 font-semibold">Fit to View</button>
                <button data-action="zoom-in" class="text-slate-600 hover:text-slate-900">Zoom +</button>
                <button data-action="zoom-out" class="text-slate-600 hover:text-slate-900">Zoom −</button>
              </div>
            </div>
            <div id="diagram-scroll" class="overflow-auto" style="max-height:600px; cursor:default;">
              <svg id="diagram-svg" xmlns="http://www.w3.org/2000/svg" style="display:block;"></svg>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 px-1">
            <span class="font-semibold text-slate-600">Legend:</span>
            <span class="flex items-center gap-1.5">
              <svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="#818cf8" stroke="white" stroke-width="1.5"/><text x="9" y="9" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="white" font-weight="900">+</text></svg>
              Creates / produces sheet
            </span>
            <span class="flex items-center gap-1.5">
              <svg width="18" height="18"><circle cx="9" cy="9" r="7" fill="#e0e7ff" stroke="#818cf8" stroke-width="2"/><circle cx="9" cy="9" r="3" fill="#818cf8" opacity="0.8"/></svg>
              Reads / uses sheet
            </span>
            <span class="flex items-center gap-1.5">
              <svg width="32" height="10"><line x1="0" y1="5" x2="22" y2="5" stroke="#818cf8" stroke-width="1.5" stroke-dasharray="4,2.5"/><polygon points="18,2 27,5 18,8" fill="#818cf8" opacity="0.7"/></svg>
              Data flows to next action
            </span>
            <span class="badge badge-copy">COPY</span>
            <span class="badge badge-export">EXPORT</span>
            <span class="badge badge-transform">TRANSF</span>
            <span class="badge badge-insert">INSERT</span>
            <span class="badge badge-update">UPDATE</span>
            <span class="badge badge-upsert">UPSERT</span>
            <span class="badge badge-delete">DELETE</span>
            <span class="text-slate-400 italic ml-1">Click any action to edit</span>
          </div>
        </div>
      </section>`;

    this.querySelector('[data-action="add-action"]').addEventListener('click', () => addAction());
    this.querySelector('[data-action="add-action-empty"]').addEventListener('click', () => addAction());
    this.querySelector('[data-action="fit"]').addEventListener('click', () => dFit());
    this.querySelector('[data-action="zoom-in"]').addEventListener('click', () => dZoom(1.25));
    this.querySelector('[data-action="zoom-out"]').addEventListener('click', () => dZoom(0.8));

    this.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => this._switchView(btn.dataset.view));
    });

    bus.on('tab-switch', name => {
      this.querySelector('section').classList.toggle('active', name === 'actions');
      if (name === 'actions' && document.getElementById('view-diagram') && !document.getElementById('view-diagram').classList.contains('hidden')) {
        renderDiagram();
      }
    });

    bus.on('actions-changed', () => {
      renderActions();
      if (!document.getElementById('view-diagram')?.classList.contains('hidden')) {
        renderDiagram();
      }
    });
  }

  _switchView(name) {
    setView(name);
    document.getElementById('view-list').classList.toggle('hidden', name !== 'list');
    document.getElementById('view-diagram').classList.toggle('hidden', name !== 'diagram');
    document.getElementById('view-list-btn').classList.toggle('active', name === 'list');
    document.getElementById('view-diagram-btn').classList.toggle('active', name === 'diagram');
    if (name === 'diagram') renderDiagram();
  }
}

customElements.define('sf-actions-panel', SfActionsPanel);
