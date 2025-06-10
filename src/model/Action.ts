import { TransformAction } from './TransformAction';
import { ImportAction } from './ImportAction';
import { ExportAction } from './ExportAction';
import { ActionField } from './ActionField';

export class Action {
  name: string;
  inputSheet: string;
  outputSheet: string;
  waitStartingTime: number = 0;
  transformAction?: TransformAction;
  importAction?: ImportAction;
  exportAction?: ExportAction;
  fields: ActionField[];

  constructor(
    name: string,
    inputSheet: string,
    outputSheet: string,
    waitStartingTime: number = 0,
    transformAction?: TransformAction,
    importAction?: ImportAction,
    exportAction?: ExportAction,
    fields: ActionField[] = []
  ) {
    this.name = name;
    this.inputSheet = inputSheet;
    this.outputSheet = outputSheet || inputSheet;
    this.waitStartingTime = waitStartingTime;
    this.transformAction = transformAction;
    this.importAction = importAction;
    this.exportAction = exportAction;
    this.fields = fields;
  }
}