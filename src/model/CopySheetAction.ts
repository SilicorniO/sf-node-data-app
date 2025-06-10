import { SheetField } from './SheetField';

export class CopySheetAction {
  copyFields: SheetField[];

  constructor(copyFields: SheetField[] = []) {
    this.copyFields = copyFields;
  }
}