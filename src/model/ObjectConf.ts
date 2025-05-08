// src/model/ObjectConf.ts
import { FieldConf } from './FieldConf';
export class ObjectConf {
  name: string;
  sfObject: string;
  fieldsConf: FieldConf[];
  constructor(name: string, sfObject: string, fieldsConf: FieldConf[]) {
    this.name = name;
    this.sfObject = sfObject;
    this.fieldsConf = fieldsConf;
  }
}