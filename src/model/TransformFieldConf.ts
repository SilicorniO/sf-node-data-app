// src/model/FieldConf.ts
export class TransformFieldConf {
  name: string;
  transformation: string;
  constructor(name: string, transformation: string) {
    this.name = name;
    this.transformation = transformation;
  }
}