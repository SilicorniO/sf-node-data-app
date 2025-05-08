// src/model/FieldConf.ts
export class FieldConf {
  api_name: string;
  transformation: string;
  constructor(api_name: string, transformation: string) {
    this.api_name = api_name;
    this.transformation = transformation;
  }
}