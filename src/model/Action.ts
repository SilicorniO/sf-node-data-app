import { TransformAction } from './TransformAction';
import { ImportAction } from './ImportAction';
import { ExportAction } from './ExportAction';
import { ActionField } from './ActionField';

export class Action {
  name: string;
  waitStartingTime: number = 0;
  transformAction?: TransformAction;
  importAction?: ImportAction;
  exportAction?: ExportAction;
  fields: ActionField[];

  constructor(
    name: string,
    waitStartingTime?: number,
    transformAction?: TransformAction,
    importAction?: ImportAction,
    exportAction?: ExportAction,
    fields: ActionField[] = []
  ) {
    this.name = name;
    this.waitStartingTime = waitStartingTime || 0;
    this.transformAction = transformAction;
    this.importAction = importAction;
    this.exportAction = exportAction;
    this.fields = fields;
  }
}