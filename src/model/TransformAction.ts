import { Action, ActionOptions } from './Action';

export class TransformAction extends Action {
  readonly type = 'transform' as const;

  constructor(
    name: string,
    readonly inputSheet: string,
    readonly outputSheet: string,
    readonly scriptFile: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}