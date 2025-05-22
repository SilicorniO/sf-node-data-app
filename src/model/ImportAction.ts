export type ActionType = "insert" | "update" | "upsert" | "delete";
export class ImportAction {
  objectName:string;
  uniqueColumn: string;
  action: ActionType;
  importColumns: string[];
  constructor(objectName: string, uniqueColumn: string, action: ActionType, importColumns: string[]) {
    this.objectName= objectName;
    this.uniqueColumn = uniqueColumn;
    this.action = action;
    this.importColumns = importColumns;
  }
}