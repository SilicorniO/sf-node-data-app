import { Action, ActionOptions } from './Action';

export class MergeAction extends Action {
  readonly type = 'merge' as const;

  constructor(
    name: string,
    readonly primarySheet: string,
    readonly secondarySheet: string,
    readonly outputSheet: string,
    readonly idField: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
