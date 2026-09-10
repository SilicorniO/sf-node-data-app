import { Action, ActionOptions } from './Action';

export class CheckAction extends Action {
  readonly type = 'check' as const;

  constructor(
    name: string,
    readonly inputSheets: string[],
    readonly scriptFile: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
