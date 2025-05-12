import { TransformAction } from './TransformAction';
import { ImportAction } from './ImportAction';

export class Action {
  name: string;
  transformAction?: TransformAction;
  importAction?: ImportAction;

  constructor(
    name: string,
    transformAction?: TransformAction,
    importAction?: ImportAction
  ) {
    this.name = name;
    this.transformAction = transformAction;
    this.importAction = importAction;
  }
}