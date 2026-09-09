// src/model/ImportConf.ts
// "auto" picks between "api" and "bulk" per action at runtime based on record
// count (see AutoModeSelector); autoBulkThreshold is the cutover point.
export type ProcessingType = "api" | "bulk" | "auto";
export class AppConfiguration {
  processingType: ProcessingType = "api";
  bulkApiMaxWaitSec: number | null;
  bulkApiPollIntervalSec: number | null;
  apiVersion: string;
  cleanOutputFolderBeforeExecution: boolean;
  deleteErrorFilesBeforeExecution: boolean;
  queryApiBatchSize: number;
  autoBulkThreshold: number;
  constructor(
    processingType: ProcessingType,
    bulkApiMaxWaitSec: number | null,
    bulkApiPollIntervalSec: number | null,
    apiVersion: string,
    cleanOutputFolderBeforeExecution = false,
    deleteErrorFilesBeforeExecution = false,
    queryApiBatchSize = 2000,
    autoBulkThreshold = 10000
  ) {
    this.processingType = processingType;
    this.bulkApiMaxWaitSec = bulkApiMaxWaitSec;
    this.bulkApiPollIntervalSec = bulkApiPollIntervalSec;
    this.apiVersion = apiVersion;
    this.cleanOutputFolderBeforeExecution = cleanOutputFolderBeforeExecution;
    this.deleteErrorFilesBeforeExecution = deleteErrorFilesBeforeExecution;
    this.queryApiBatchSize = queryApiBatchSize;
    this.autoBulkThreshold = autoBulkThreshold;
  }
}