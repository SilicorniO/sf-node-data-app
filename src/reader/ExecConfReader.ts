import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { FieldConf } from '../model/FieldConf';
import { Action } from '../model/Action';
import { TransformAction } from '../model/TransformAction';
import { ImportAction } from '../model/ImportAction';
import { ImportConf } from '../model/ImportConf';
import { ExecConf } from '../model/ExecConf';

export class ExecConfReader {
  static readConfFile(confFilePath: string): ExecConf {
    try {
      const confFileContent = fs.readFileSync(path.resolve(confFilePath), 'utf8');
      const confData: any = yaml.load(confFileContent);

      // Construct ImportConf
      const importConf = this.parseImportConf(confData.importConf);

      // Construct Action array
      const actions = this.parseActions(confData.objectsConf || confData.actions);

      // Construct ExecConf
      const execConf = new ExecConf(importConf, actions);
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

  private static parseActions(actionsData: any[]): Action[] {
    if (!Array.isArray(actionsData)) {
      return [];
    }
    return actionsData.map(actionData => this.parseAction(actionData));
  }

  private static parseAction(actionData: any): Action {
    const name = actionData?.name ?? null;

    let transformAction: TransformAction | undefined = undefined;
    if (actionData?.transformAction?.fieldsConf) {
      const fieldsConf = this.parseFieldsConf(actionData.transformAction.fieldsConf);
      transformAction = new TransformAction(fieldsConf);
    }

    let importAction: ImportAction | undefined = undefined;
    // sfObject is now importName inside importAction
    if (actionData?.importAction?.uniqueFieldName || actionData?.importAction?.importName) {
      // Support both new and legacy config
      const importName = actionData?.importAction?.importName ?? actionData?.sfObject ?? null;
      const uniqueFieldName = actionData?.importAction?.uniqueFieldName ?? null;
      if (importName && uniqueFieldName) {
        importAction = new ImportAction(importName, uniqueFieldName);
      }
    }

    return new Action(name, transformAction, importAction);
  }

  private static parseFieldsConf(fieldsConfData: any[]): FieldConf[] {
    if (!Array.isArray(fieldsConfData)) {
      return [];
    }
    return fieldsConfData.map(fieldConfData => this.parseFieldConf(fieldConfData));
  }

  private static parseFieldConf(fieldConfData: any): FieldConf {
    const fieldName = fieldConfData?.fieldName ?? null;
    const transformation = fieldConfData?.transformation ?? null;
    return new FieldConf(fieldName, transformation);
  }
}