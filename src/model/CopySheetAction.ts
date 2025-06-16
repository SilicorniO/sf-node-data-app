import { SheetField } from './SheetField';

export class CopySheetAction {
  copyFields: SheetField[];
  uniqueField?: string;

  constructor(copyFields: SheetField[] = [], uniqueField?: string) {
    this.copyFields = copyFields;
    this.uniqueField = uniqueField;
  }
}