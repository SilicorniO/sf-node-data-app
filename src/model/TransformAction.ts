import { FieldConf } from "./FieldConf";

export class TransformAction {
  fieldsConf: FieldConf[];
  constructor(fieldsConf: FieldConf[]) {
    this.fieldsConf = fieldsConf;
  }
}