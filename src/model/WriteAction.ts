import { Action, ActionOptions } from './Action';

export abstract class WriteAction extends Action {
  protected constructor(
    name: string,
    readonly object: string,
    readonly inputSheet: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
