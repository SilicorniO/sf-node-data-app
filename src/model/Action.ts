import { TransformAction } from './TransformAction';
import { ImportAction } from './ImportAction';
import { ExportAction } from './ExportAction';

export class Action {
  name: string;
  waitStartingTime: number = 0;
  transformAction?: TransformAction;
  importAction?: ImportAction;
  exportAction?: ExportAction;

  constructor(
    name: string,
    waitStartingTime?: number,
    transformAction?: TransformAction,
    importAction?: ImportAction,
    exportAction?: ExportAction
  ) {
    this.name = name;
    this.waitStartingTime = waitStartingTime || 0;
    this.transformAction = transformAction;
    this.importAction = importAction;
    this.exportAction = exportAction;
  }
}