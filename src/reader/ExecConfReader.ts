// src/reader/ExecConfReader.ts
import * as fs from 'fs';
import * as path from 'path';
import { FieldConf } from '../model/FieldConf';
import { ObjectConf } from '../model/ObjectConf';
import { ImportConf } from '../model/ImportConf';
import { ExecConf } from '../model/ExecConf';

export class ExecConfReader {
  static readConfFile(confFilePath: string): ExecConf {
    try {
      const confFileContent = fs.readFileSync(path.resolve(confFilePath), 'utf8');
      const confData = JSON.parse(confFileContent);

      // Construct ImportConf
      const importConf = this.parseImportConf(confData.importConf);

      // Construct ObjectConf array
      const objectsConf = this.parseObjectsConf(confData.objectsConf);

      // Construct ExecConf
      const execConf = new ExecConf(importConf, objectsConf);
      return execConf;
    } catch (error: any) {
      throw new Error(`Error reading or parsing configuration file: ${error.message}`);
    }
  }

  private static parseImportConf(importConfData: any): ImportConf {
    const bulkApiMaxWaitSec = importConfData?.bulkApiMaxWaitSec ?? null;
    const bulkApiPollIntervalSec = importConfData?.bulkApiPollIntervalSec ?? null;

    return new ImportConf(bulkApiMaxWaitSec, bulkApiPollIntervalSec);
  }

  private static parseObjectsConf(objectsConfData: any[]): ObjectConf[] {
    if (!Array.isArray(objectsConfData)) {
      return []; // Return empty array if objectsConfData is not an array
    }

    return objectsConfData.map(objConfData => this.parseObjectConf(objConfData));
  }

  private static parseObjectConf(objConfData: any): ObjectConf {
    const name = objConfData?.name ?? null;
    const sfObject = objConfData?.sfObject ?? null;
    const fieldsConf = objConfData?.fieldsConf ? this.parseFieldsConf(objConfData.fieldsConf) : [];

    return new ObjectConf(name, sfObject, fieldsConf);
  }

  private static parseFieldsConf(fieldsConfData: any[]): FieldConf[] {
      if (!Array.isArray(fieldsConfData)) {
          return [];
      }
    return fieldsConfData.map(fieldConfData => this.parseFieldConf(fieldConfData));
  }

  private static parseFieldConf(fieldConfData: any): FieldConf {
    const api_name = fieldConfData?.api_name ?? null;
    const transformation = fieldConfData?.transformation ?? null;
    return new FieldConf(api_name, transformation);
  }
}
