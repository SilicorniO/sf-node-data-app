// src/model/ExecConf.ts
import { ImportConf } from './ImportConf';
import { Action } from './Action';
export class ExecConf {
  importConf: ImportConf;
  actions: Action[];
  constructor(importConf: ImportConf, actions: Action[]) {
    this.importConf = importConf;
    this.actions = actions;
  }
}