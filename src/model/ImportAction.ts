export type ActionType = "insert" | "update" | "upsert" | "delete";
export class ImportAction {
  importName:string;
  uniqueColumnName: string;
  action: ActionType;
  importColumns: string[];
  constructor(importName: string, uniqueColumnName: string, action: ActionType, importColumns: string[]) {
    this.importName= importName;
    this.uniqueColumnName = uniqueColumnName;
    this.action = action;
    this.importColumns = importColumns;
  }
}