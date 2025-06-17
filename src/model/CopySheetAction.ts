import { SheetField } from './SheetField';

export class CopySheetAction {
  copyFields: SheetField[];
  uniqueField?: string;
  condition?: string;

  constructor(copyFields: SheetField[] = [], uniqueField?: string, condition?: string) {
    this.copyFields = copyFields;
    this.uniqueField = uniqueField;
    this.condition = condition;
  }
}