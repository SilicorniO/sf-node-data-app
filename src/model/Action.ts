import { TransformAction } from './TransformAction';
import { ImportAction } from './ImportAction';
import { ExportAction } from './ExportAction';
import { CopySheetAction } from './CopySheetAction';

export class Action {
  name: string;
  inputSheet: string;
  outputSheet: string;
  waitStartingTime: number = 0;
  transformAction?: TransformAction;
  importAction?: ImportAction;
  exportAction?: ExportAction;
  copySheetAction?: CopySheetAction;

  constructor(
    name: string,
    inputSheet: string,
    outputSheet: string,
    waitStartingTime: number = 0,
    transformAction?: TransformAction,
    importAction?: ImportAction,
    exportAction?: ExportAction,
    copySheetAction?: CopySheetAction
  ) {
    this.name = name;
    this.inputSheet = inputSheet;
    this.outputSheet = outputSheet || inputSheet;
    this.waitStartingTime = waitStartingTime;
    this.transformAction = transformAction;
    this.importAction = importAction;
    this.exportAction = exportAction;
    this.copySheetAction = copySheetAction;
  }
}