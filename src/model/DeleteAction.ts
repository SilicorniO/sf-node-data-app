import { ActionOptions } from './Action';
import { WriteAction } from './WriteAction';

export class DeleteAction extends WriteAction {
  readonly type = 'delete' as const;

  constructor(
    name: string,
    object: string,
    inputSheet: string,
    options: ActionOptions = {}
  ) {
    super(name, object, inputSheet, options);
  }
}
