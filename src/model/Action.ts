import { TransformAction } from './TransformAction';
import { ImportAction } from './ImportAction';

export class Action {
  name: string;
  waitStartingTime: number = 0;
  transformAction?: TransformAction;
  importAction?: ImportAction;

  constructor(
    name: string,
    waitStartingTime?: number,
    transformAction?: TransformAction,
    importAction?: ImportAction
  ) {
    this.name = name;
    this.waitStartingTime = waitStartingTime || 0;
    this.transformAction = transformAction;
    this.importAction = importAction;
  }
}