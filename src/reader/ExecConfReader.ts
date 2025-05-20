import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { FieldConf } from '../model/FieldConf';
import { Action } from '../model/Action';
import { TransformAction } from '../model/TransformAction';
import { ImportAction } from '../model/ImportAction';
import { ExportAction } from '../model/ExportAction';
import { AppConfiguration } from '../model/AppConfiguration';
import { ExecConf } from '../model/ExecConf';

export class ExecConfReader {
  static readConfFile(confFilePath: string): ExecConf {
    try {
      const confFileContent = fs.readFileSync(path.resolve(confFilePath), 'utf8');
      const confData: any = yaml.load(confFileContent);

      // Construct ImportConf
      const importConf = this.parseImportConf(confData.appConfiguration);

      // Construct Action array
      const actions = this.parseActions(confData.objectsConf || confData.actions);

      // Construct ExecConf
      const execConf = new ExecConf(importConf, actions);
      return execConf;
    } catch (error: any) {
      throw new Error(`Error reading or parsing configuration file: ${error.message}`);
    }
  }

  private static parseImportConf(importConfData: any): AppConfiguration {
    const bulkApiMaxWaitSec = importConfData?.bulkApiMaxWaitSec ?? null;
    const bulkApiPollIntervalSec = importConfData?.bulkApiPollIntervalSec ?? null;
    const stopOnError = importConfData?.stopOnError ?? false;
    const rollbackOnError = importConfData?.rollbackOnError ?? false;
    const apiVersion = importConfData?.apiVersion ?? "58.0";

    return new AppConfiguration(bulkApiMaxWaitSec, bulkApiPollIntervalSec, stopOnError, rollbackOnError, apiVersion);
  }

  private static parseActions(actionsData: any[]): Action[] {
    if (!Array.isArray(actionsData)) {
      return [];
    }
    return actionsData.map(actionData => this.parseAction(actionData));
  }

  private static parseAction(actionData: any): Action {
    const name = actionData?.name ?? null;
    const waitStartingTime = actionData?.waitStartingTime ?? 0;

    let transformAction: TransformAction | undefined = undefined;
    if (actionData?.transformAction?.fieldsConf) {
      const fieldsConf = this.parseFieldsConf(actionData.transformAction.fieldsConf);
      transformAction = new TransformAction(fieldsConf);
    }

    let importAction: ImportAction | undefined = undefined;
    // Parse all fields as defined in ImportAction model
    if (
      actionData?.importAction?.importName ||
      actionData?.importAction?.uniqueFieldName ||
      actionData?.importAction?.idFieldName ||
      actionData?.importAction?.action
    ) {
      const importName = actionData.importAction.importName ?? null;
      const uniqueFieldName = actionData.importAction.uniqueFieldName ?? null;
      const idFieldName = actionData.importAction.idFieldName ?? null;
      const action = actionData.importAction.action ?? null;
      if (importName && action) {
        importAction = new ImportAction(importName, uniqueFieldName, idFieldName, action);
      }
    }

    // Parse exportAction if present
    let exportAction: ExportAction | undefined = undefined;
    if (actionData?.exportAction?.query) {
      exportAction = new ExportAction(actionData.exportAction.query);
    }

    return new Action(name, waitStartingTime, transformAction, importAction, exportAction);
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