'use strict';

import { state, resetUid } from './state.js';
import { toast } from './utils.js';
import { syncSheets } from './sheets.js';
import { addSheet, renderSheets } from './sheets.js';
import { addAction, renderActions } from './actions.js';
import { bus } from './state.js';

function buildYamlObj() {
  syncSheets();

  const appConfig = {
    processingType:        document.getElementById('cfg-processingType').value,
    bulkApiMaxWaitSec:     parseFloat(document.getElementById('cfg-maxWait').value) || 300,
    bulkApiPollIntervalSec: parseFloat(document.getElementById('cfg-pollInterval').value) || 5,
    stopOnError:           document.getElementById('cfg-stopOnError').checked,
    rollbackOnError:       document.getElementById('cfg-rollbackOnError').checked,
    apiVersion:            document.getElementById('cfg-apiVersion').value || '63.0',
  };

  const sheets = state.sheets
    .filter(s => s.name)
    .map(s => ({
      name:   s.name,
      fields: s.fields.filter(f => f.name).map(f => ({ name: f.name, apiName: f.apiName || f.name })),
    }))
    .filter(s => s.fields.length);

  const clean = obj => {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === 'object') {
      const r = {};
      Object.entries(obj).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        if (Array.isArray(v) && !v.length) return;
        r[k] = clean(v);
      });
      return r;
    }
    return obj;
  };

  const actions = state.actions.map(a => {
    const obj = { name: a.name };
    if (a.inputSheet)  obj.inputSheet  = a.inputSheet;
    if (a.outputSheet) obj.outputSheet = a.outputSheet;
    if (a.waitStartingTime > 0) obj.waitStartingTime = a.waitStartingTime;
    if (a.copySheetAction) {
      const csa = {};
      if (a.copySheetAction.condition)   csa.condition   = a.copySheetAction.condition;
      if (a.copySheetAction.uniqueField) csa.uniqueField = a.copySheetAction.uniqueField;
      if (a.copySheetAction.copyFields?.length) csa.copyFields = a.copySheetAction.copyFields;
      obj.copySheetAction = csa;
    }
    if (a.exportAction) {
      const ea = { query: a.exportAction.query };
      if (a.exportAction.uniqueField) ea.uniqueField = a.exportAction.uniqueField;
      obj.exportAction = ea;
    }
    if (a.transformAction?.fieldsConf?.length) {
      obj.transformAction = { fieldsConf: a.transformAction.fieldsConf };
    }
    if (a.importAction) {
      const ia = { objectName: a.importAction.objectName, action: a.importAction.action };
      if (a.importAction.uniqueField)   ia.uniqueField   = a.importAction.uniqueField;
      if (a.importAction.importFields?.length) ia.importFields = a.importAction.importFields;
      obj.importAction = ia;
    }
    return clean(obj);
  });

  const result = { appConfiguration: appConfig };
  if (sheets.length)  result.sheets  = sheets;
  if (actions.length) result.actions = actions;
  return result;
}

export function genYaml() {
  try {
    return jsyaml.dump(buildYamlObj(), { lineWidth: 120, noRefs: true, quotingType: "'" });
  } catch (e) {
    return `# Error: ${e.message}`;
  }
}

export function refreshYaml() {
  document.getElementById('yaml-preview').textContent = genYaml();
}

export function refreshAndGoIO() {
  refreshYaml();
  bus.emit('tab-switch', 'io');
}

export function downloadYaml() {
  const y = genYaml();
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([y], { type: 'text/yaml' }));
  a.download = 'conf.yaml';
  a.click();
  toast('YAML downloaded');
}

export function copyYaml() {
  const y = genYaml();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(y).then(() => toast('Copied to clipboard'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = y;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied to clipboard');
  }
}

function loadConf(conf) {
  state.sheets  = [];
  state.actions = [];
  resetUid(1);

  const c = conf.appConfiguration || {};
  document.getElementById('cfg-processingType').value  = c.processingType || 'bulk';
  document.getElementById('cfg-maxWait').value          = c.bulkApiMaxWaitSec ?? 300;
  document.getElementById('cfg-pollInterval').value     = c.bulkApiPollIntervalSec ?? 5;
  document.getElementById('cfg-stopOnError').checked    = c.stopOnError !== undefined ? c.stopOnError : true;
  document.getElementById('cfg-rollbackOnError').checked = c.rollbackOnError || false;
  document.getElementById('cfg-apiVersion').value       = c.apiVersion || '63.0';

  (conf.sheets || []).forEach(s => addSheet(s));
  (conf.actions || conf.objectsConf || []).forEach(a => addAction(a));

  renderSheets();
  renderActions();
}

export function parseAndLoad(text) {
  try {
    const conf = jsyaml.load(text);
    if (!conf || typeof conf !== 'object') throw new Error('Invalid YAML — not an object');
    loadConf(conf);
    toast('Configuration loaded successfully');
    bus.emit('tab-switch', 'config');
  } catch (e) {
    toast(`Parse error: ${e.message}`, 'error');
  }
}

export function importFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload  = e => parseAndLoad(e.target.result);
  r.onerror = () => toast('Error reading file', 'error');
  r.readAsText(file);
  document.getElementById('yaml-file-input').value = '';
}

export function handleDrop(e) {
  const file = e.dataTransfer?.files?.[0];
  if (file) importFile(file);
}

export function importText() {
  const t = document.getElementById('yaml-text-input').value.trim();
  if (!t) { toast('No YAML text provided', 'warning'); return; }
  parseAndLoad(t);
}
