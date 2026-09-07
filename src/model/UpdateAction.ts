import { ActionOptions } from './Action';
import { WriteAction } from './WriteAction';

export class UpdateAction extends WriteAction {
  readonly type = 'update' as const;

  constructor(
    name: string,
    object: string,
    inputSheet: string,
    readonly fields: string[],
    options: ActionOptions = {}
  ) {
    super(name, object, inputSheet, options);
  }
}
