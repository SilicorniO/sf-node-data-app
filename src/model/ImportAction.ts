export type ActionType = "insert" | "update" | "upsert" | "delete";
export class ImportAction {
  objectName:string;
  uniqueField: string;
  action: ActionType;
  importColumns: string[];
  constructor(objectName: string, uniqueField: string, action: ActionType, importColumns: string[]) {
    this.objectName= objectName;
    this.uniqueField = uniqueField;
    this.action = action;
    this.importColumns = importColumns;
  }
}