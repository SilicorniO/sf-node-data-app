// src/model/ExecConf.ts
import { AppConfiguration } from './AppConfiguration';
import { Action } from './Action';
export class ExecConf {
  appConfiguration: AppConfiguration;
  actions: Action[];
  constructor(appConfiguration: AppConfiguration, actions: Action[]) {
    this.appConfiguration = appConfiguration;
    this.actions = actions;
  }
}