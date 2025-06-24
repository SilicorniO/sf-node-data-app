// src/model/ImportConf.ts
export type ProcessingType = "bulk" | "api";
export class AppConfiguration {
  processingType: ProcessingType = "bulk";
  bulkApiMaxWaitSec: number;
  bulkApiPollIntervalSec: number;
  stopOnError: boolean;
  rollbackOnError: boolean;
  apiVersion: string;
  constructor(processingType: ProcessingType, bulkApiMaxWaitSec: number, bulkApiPollIntervalSec: number, stopOnError: boolean, rollbackOnError: boolean, apiVersion: string) {
    this.processingType = processingType;
    this.bulkApiMaxWaitSec = bulkApiMaxWaitSec;
    this.bulkApiPollIntervalSec = bulkApiPollIntervalSec;
    this.stopOnError = stopOnError;
    this.rollbackOnError = rollbackOnError;
    this.apiVersion = apiVersion;
  }
}