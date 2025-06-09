import { ImportFieldConf } from "./ImportFieldConf";

export type ActionType = "insert" | "update" | "upsert" | "delete";
export class ImportAction {
  objectName: string;
  uniqueField: string;
  action: ActionType;
  importFields: ImportFieldConf[];
  constructor(objectName: string, uniqueField: string, action: ActionType, importFields: ImportFieldConf[]) {
    this.objectName = objectName;
    this.uniqueField = uniqueField;
    this.action = action;
    this.importFields = importFields;
  }
}