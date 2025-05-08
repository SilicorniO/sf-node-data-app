// src/model/ExecConf.ts
import { ImportConf } from './ImportConf';
import { ObjectConf } from './ObjectConf';
export class ExecConf {
  importConf: ImportConf;
  objectsConf: ObjectConf[];
  constructor(importConf: ImportConf, objectsConf: ObjectConf[]) {
    this.importConf = importConf;
    this.objectsConf = objectsConf;
  }
}