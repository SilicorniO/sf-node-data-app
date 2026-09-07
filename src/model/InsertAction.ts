import { ActionOptions } from './Action';
import { WriteAction } from './WriteAction';

export class InsertAction extends WriteAction {
  readonly type = 'insert' as const;

  constructor(
    name: string,
    object: string,
    inputSheet: string,
    readonly fields: string[],
    readonly outputSheet?: string,
    options: ActionOptions = {}
  ) {
    super(name, object, inputSheet, options);
  }
}
