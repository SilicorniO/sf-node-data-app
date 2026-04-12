'use strict';

export let _uid = 1;
export const uid = () => String(_uid++);
export const resetUid = (n = 1) => { _uid = n; };

export const state = {
  sheets: [],
  actions: [],
};

const _bus = new EventTarget();

export const bus = {
  on(event, cb) {
    _bus.addEventListener(event, e => cb(e.detail));
  },
  emit(event, data) {
    _bus.dispatchEvent(new CustomEvent(event, { detail: data }));
  },
};
