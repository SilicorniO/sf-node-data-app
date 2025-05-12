export class ImportAction {
  importName:string;
  uniqueFieldName: string;
  constructor(importName: string, uniqueFieldName: string) {
    this.importName= importName;
    this.uniqueFieldName = uniqueFieldName;
  }
}