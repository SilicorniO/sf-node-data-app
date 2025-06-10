export class CopySheetAction {
  copyFields: string[];

  constructor(copyFields: string[] = []) {
    this.copyFields = copyFields;
  }
}