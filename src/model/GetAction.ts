import { Action, ActionOptions } from './Action';

export class GetAction extends Action {
  readonly type = 'get' as const;

  constructor(
    name: string,
    readonly outputSheet: string,
    readonly query: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
