export type ActionType = "insert" | "update" | "upsert" | "delete";
export class ImportAction {
  importName:string;
  uniqueFieldName: string;
  idFieldName: string;
  action: ActionType;
  constructor(importName: string, uniqueFieldName: string, idFieldName: string, action: ActionType) {
    this.importName= importName;
    this.uniqueFieldName = uniqueFieldName;
    this.idFieldName = idFieldName;
    this.action = action;
  }
}