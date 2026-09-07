import { ActionOptions } from './Action';
import { WriteAction } from './WriteAction';

export class UpsertAction extends WriteAction {
  readonly type = 'upsert' as const;

  constructor(
    name: string,
    object: string,
    inputSheet: string,
    readonly fields: string[],
    readonly externalIdField: string,
    options: ActionOptions = {}
  ) {
    super(name, object, inputSheet, options);
  }
}
