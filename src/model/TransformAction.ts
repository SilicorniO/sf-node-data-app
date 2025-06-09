import { TransformFieldConf } from "./TransformFieldConf";

export class TransformAction {
  fieldsConf: TransformFieldConf[];
  constructor(fieldsConf: TransformFieldConf[]) {
    this.fieldsConf = fieldsConf;
  }
}