import { SheetField } from './SheetField';

export class SheetConf {
  name: string;
  fields: SheetField[];

  constructor(name: string, fields: SheetField[] = []) {
    this.name = name;
    this.fields = fields;
  }
}