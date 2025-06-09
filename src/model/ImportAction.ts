import { ActionField } from "./ActionField";

export type ActionType = "insert" | "update" | "upsert" | "delete";
export class ImportAction {
  objectName: string;
  uniqueField: string;
  action: ActionType;
  importFields: string[];

  constructor(objectName: string, uniqueField: string, action: ActionType, importFields: string[] = []) {
    this.objectName = objectName;
    this.uniqueField = uniqueField;
    this.action = action;
    this.importFields = importFields;
  }
}