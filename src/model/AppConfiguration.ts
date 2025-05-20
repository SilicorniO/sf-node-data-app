// src/model/ImportConf.ts
export class AppConfiguration {
  bulkApiMaxWaitSec: number;
  bulkApiPollIntervalSec: number;
  stopOnError: boolean;
  rollbackOnError: boolean;
  apiVersion: string;
  constructor(bulkApiMaxWaitSec: number, bulkApiPollIntervalSec: number, stopOnError: boolean, rollbackOnError: boolean, apiVersion: string) {
    this.bulkApiMaxWaitSec = bulkApiMaxWaitSec;
    this.bulkApiPollIntervalSec = bulkApiPollIntervalSec;
    this.stopOnError = stopOnError;
    this.rollbackOnError = rollbackOnError;
    this.apiVersion = apiVersion;
  }
}