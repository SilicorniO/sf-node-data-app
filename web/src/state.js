'use strict';

const STORAGE_KEY = 'sfdata.yaml-generator.v2';
let nextId = 1;
const listeners = new Set();

export const defaultState = () => ({
  appConfiguration: {
    processingType: 'api',
    bulkApiMaxWaitSec: '',
    bulkApiPollIntervalSec: '',
    apiVersion: '58.0',
    queryApiBatchSize: 2000,
    cleanOutputFolderBeforeExecution: false,
    deleteErrorFilesBeforeExecution: false,
  },
  sheets: [],
  actions: [],
  activeTab: 'app',
});

export let state = defaultState();

export const uid = () => `item-${nextId++}`;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(reason = 'change') {
  persistDraft();
  listeners.forEach(listener => listener(reason));
}

export function replaceState(nextState, reason = 'replace') {
  state = normalizeState(nextState);
  notify(reason);
}

export function resetState() {
  nextId = 1;
  state = defaultState();
  localStorage.removeItem(STORAGE_KEY);
  listeners.forEach(listener => listener('reset'));
}

export function restoreDraft() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return false;
    state = normalizeState(JSON.parse(value));
    return true;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

function persistDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeState(value = {}) {
  const defaults = defaultState();
  return {
    appConfiguration: {
      ...defaults.appConfiguration,
      ...(value.appConfiguration || {}),
      processingType: value.appConfiguration?.processingType === 'bulk' ? 'bulk' : 'api',
    },
    sheets: (value.sheets || []).map(sheet => ({
      id: sheet.id || uid(),
      name: sheet.name || '',
      source: sheet.source || null,
      collapsed: Boolean(sheet.collapsed),
      fields: (sheet.fields || []).map(field => ({
        id: field.id || uid(),
        name: field.name || '',
        apiName: field.apiName || '',
        translate: field.translate ?? Boolean(field.apiName && field.apiName !== field.name),
      })),
    })),
    actions: (value.actions || []).map(action => ({
      ...action,
      id: action.id || uid(),
      fields: action.fields ? [...action.fields] : undefined,
    })),
    activeTab: ['app', 'sheets', 'actions', 'preview', 'diagram'].includes(value.activeTab)
      ? value.activeTab
      : 'app',
  };
}
