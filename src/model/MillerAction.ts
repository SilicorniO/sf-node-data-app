import { Action, ActionOptions } from './Action';

export class MillerAction extends Action {
  readonly type = 'miller' as const;

  constructor(
    name: string,
    readonly inputSheets: string[],
    readonly outputSheet: string,
    readonly command: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
