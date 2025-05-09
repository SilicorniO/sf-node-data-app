// src/model/ObjectConf.ts
import { FieldConf } from './FieldConf';
export class ObjectConf {
  name: string;
  sfObject: string;
  fieldsConf: FieldConf[];
  uniqueFieldApiName: string;
  constructor(name: string, sfObject: string, uniqueFieldApiName: string, fieldsConf: FieldConf[]) {
    this.name = name;
    this.sfObject = sfObject;
    this.uniqueFieldApiName = uniqueFieldApiName;
    this.fieldsConf = fieldsConf;
  }
}