'use strict';

import { bus } from '../state.js';

const TABS = [
  { id: 'config',  label: '⚙ App Config',       badge: null },
  { id: 'sheets',  label: '📋 Sheets',            badge: 'badge-sheets' },
  { id: 'actions', label: '⚡ Actions',            badge: 'badge-actions' },
  { id: 'io',      label: '⬆⬇ Import / Export',  badge: null },
];

class SfTabBar extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div class="max-w-screen-xl mx-auto px-5 flex items-end gap-0 overflow-x-auto">
          ${TABS.map(t => `
            <button class="tab-btn${t.id === 'config' ? ' active' : ''}" data-tab="${t.id}">
              ${t.label}
              ${t.badge ? `<span id="${t.badge}" class="ml-1.5 bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">0</span>` : ''}
            </button>`).join('')}
        </div>
      </div>`;

    this.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => bus.emit('tab-switch', btn.dataset.tab));
    });

    bus.on('tab-switch', name => {
      this.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === name)
      );
    });
  }
}

customElements.define('sf-tab-bar', SfTabBar);
