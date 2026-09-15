import { Action, ActionOptions } from './Action';

/** SQLite column type a table column may be declared as. Defaults to TEXT. */
export type TableColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'NUMERIC';

/**
 * A single column override for a `table` action. `source` is the field name in the
 * input sheet; `name` (optional) renames it in the created table; `type` (optional)
 * sets its SQLite storage type. Fields not listed keep their original name and TEXT.
 */
export interface TableColumn {
  source: string;
  name?: string;
  type?: TableColumnType;
}

/**
 * Creates a SQLite table from an input sheet as a side effect (no output sheet). The
 * table is named after the input sheet and holds the sheet's real field names as
 * columns. Once created, later merge/lookup/sql actions use it instead of running in
 * memory.
 */
export class TableAction extends Action {
  readonly type = 'table' as const;

  constructor(
    name: string,
    readonly inputSheet: string,
    readonly columns: TableColumn[],
    options: ActionOptions = {}
  ) {
    super(name, options);
  }
}
