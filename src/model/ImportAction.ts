export class ImportAction {
  importName:string;
  uniqueFieldName: string;
  idFieldName: string;
  constructor(importName: string, uniqueFieldName: string, idFieldName: string) {
    this.importName= importName;
    this.uniqueFieldName = uniqueFieldName;
    this.idFieldName = idFieldName;
  }
}