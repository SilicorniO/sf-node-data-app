// src/model/ImportConf.ts
export type ProcessingType = "api" | "bulk";
export class AppConfiguration {
  processingType: ProcessingType = "api";
  bulkApiMaxWaitSec: number | null;
  bulkApiPollIntervalSec: number | null;
  apiVersion: string;
  cleanOutputFolderBeforeExecution: boolean;
  deleteErrorFilesBeforeExecution: boolean;
  queryApiBatchSize: number;
  constructor(
    processingType: ProcessingType,
    bulkApiMaxWaitSec: number | null,
    bulkApiPollIntervalSec: number | null,
    apiVersion: string,
    cleanOutputFolderBeforeExecution = false,
    deleteErrorFilesBeforeExecution = false,
    queryApiBatchSize = 2000
  ) {
    this.processingType = processingType;
    this.bulkApiMaxWaitSec = bulkApiMaxWaitSec;
    this.bulkApiPollIntervalSec = bulkApiPollIntervalSec;
    this.apiVersion = apiVersion;
    this.cleanOutputFolderBeforeExecution = cleanOutputFolderBeforeExecution;
    this.deleteErrorFilesBeforeExecution = deleteErrorFilesBeforeExecution;
    this.queryApiBatchSize = queryApiBatchSize;
  }
}