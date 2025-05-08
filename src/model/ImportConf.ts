// src/model/ImportConf.ts
export class ImportConf {
  bulkApiMaxWaitSec: number;
  bulkApiPollIntervalSec: number;
  constructor(bulkApiMaxWaitSec: number, bulkApiPollIntervalSec: number) {
    this.bulkApiMaxWaitSec = bulkApiMaxWaitSec;
    this.bulkApiPollIntervalSec = bulkApiPollIntervalSec;
  }
}