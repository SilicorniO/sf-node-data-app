export type ActionType = 'get' | 'insert' | 'update' | 'upsert' | 'delete' | 'transform' | 'merge';
export type ErrorRows = 'errors' | 'all';

export interface ActionOptions {
  waitBeforeSeconds?: number;
  continueOnError?: boolean;
  errorSheet?: string;
  errorRows?: ErrorRows;
}

export abstract class Action {
  abstract readonly type: ActionType;
  readonly name: string;
  readonly waitBeforeSeconds: number;
  readonly continueOnError: boolean;
  readonly errorSheet: string;
  readonly errorRows: ErrorRows;

  protected constructor(name: string, options: ActionOptions = {}) {
    this.name = name;
    this.waitBeforeSeconds = options.waitBeforeSeconds ?? 0;
    this.continueOnError = options.continueOnError ?? false;
    this.errorSheet = options.errorSheet ?? `${name}-errors`;
    this.errorRows = options.errorRows ?? 'errors';
  }
}