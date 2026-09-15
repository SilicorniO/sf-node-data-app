import { Action, ActionOptions } from './Action';

/**
 * Runs a read-only SQL query against tables created by `table` actions and stores
 * the result as the output sheet. Tables are referenced by sheet name and their real
 * column names. Every input sheet listed must already have a table.
 */
export class SqlAction extends Action {
  readonly type = 'sql' as const;

  constructor(
    name: string,
    readonly inputSheets: string[],
    readonly outputSheet: string,
    readonly query: string,
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
