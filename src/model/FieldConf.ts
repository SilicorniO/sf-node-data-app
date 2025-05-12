// src/model/FieldConf.ts
export class FieldConf {
  fieldName: string;
  transformation: string;
  constructor(fieldName: string, transformation: string) {
    this.fieldName = fieldName;
    this.transformation = transformation;
  }
}