import { AppConfiguration } from './AppConfiguration';
import { Action } from './Action';
import { SheetConf } from './SheetConf';

export class ExecConf {
  appConfiguration: AppConfiguration;
  actions: Action[];
  sheets: SheetConf[];

  constructor(appConfiguration: AppConfiguration, actions: Action[], sheets: SheetConf[]) {
    this.appConfiguration = appConfiguration;
    this.actions = actions;
    this.sheets = sheets;
  }
}