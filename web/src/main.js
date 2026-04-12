'use strict';

import { bus } from './state.js';
import { renderSheets, addSheet, removeSheet, addSheetField, removeSheetField, syncSheets, toggleSheetFields } from './sheets.js';
import { renderActions, addAction, removeAction, moveAction, renderDiagram } from './actions.js';
import { openModal, updRow, delRow } from './modal.js';

// Register all web components
import './components/sf-header.js';
import './components/sf-tab-bar.js';
import './components/sf-config-panel.js';
import './components/sf-sheets-panel.js';
import './components/sf-actions-panel.js';
import './components/sf-action-modal.js';
import './components/sf-io-panel.js';

// Expose functions to window for inline event handlers generated in renderSheets / renderActions
// (these are strings embedded in innerHTML, so they need global access)
window._sfApp = {
  addSheet,
  removeSheet,
  addSheetField,
  removeSheetField,
  syncSheets,
  toggleSheetFields,
  addAction,
  removeAction,
  moveAction,
  openModal,
  updRow,
  delRow,
};

document.addEventListener('DOMContentLoaded', () => {
  bus.emit('tab-switch', 'config');
  renderSheets();
  renderActions();
});
