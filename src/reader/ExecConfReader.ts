import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { TransformFieldConf } from '../model/TransformFieldConf';
import { Action } from '../model/Action';
import { TransformAction } from '../model/TransformAction';
import { ImportAction } from '../model/ImportAction';
import { ExportAction } from '../model/ExportAction';
import { AppConfiguration } from '../model/AppConfiguration';
import { ExecConf } from '../model/ExecConf';
import { SheetConf } from '../model/SheetConf';
import { SheetField } from '../model/SheetField';
import { CopySheetAction } from '../model/CopySheetAction';

export class ExecConfReader {
  static readConfFile(confFilePath: string): ExecConf {
    try {
      const confFileContent = fs.readFileSync(path.resolve(confFilePath), 'utf8');
      const confData: any = yaml.load(confFileContent);

      // Construct ImportConf
      const importConf = this.parseImportConf(confData.appConfiguration);

      // Construct SheetConf array
      const sheets = this.parseSheets(confData.sheets);

      // Construct Action array
      const actions = this.parseActions(confData.objectsConf || confData.actions);

      // Construct ExecConf
      const execConf = new ExecConf(importConf, actions, sheets);
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

  private static parseSheets(sheetsData: any[]): SheetConf[] {
    if (!Array.isArray(sheetsData)) {
      return [];
    }
    return sheetsData.map(sheetData => this.parseSheet(sheetData));
  }

  private static parseSheet(sheetData: any): SheetConf {
    const name = sheetData?.name ?? '';
    let fields: SheetField[] = [];
    if (Array.isArray(sheetData.fields)) {
      fields = sheetData.fields.map((field: any) => {
        const fname = field?.name ?? '';
        const apiName = field?.apiName ?? fname;
        return new SheetField(fname, apiName);
      });
    }
    return new SheetConf(name, fields);
  }

  private static parseActions(actionsData: any[]): Action[] {
    if (!Array.isArray(actionsData)) {
      return [];
    }
    return actionsData.map(actionData => this.parseAction(actionData));
  }

  private static parseAction(actionData: any): Action {
    const name = actionData?.name ?? '';
    const waitStartingTime = actionData?.waitStartingTime ?? 0;

    let transformAction: TransformAction | undefined = undefined;
    if (actionData?.transformAction?.fieldsConf) {
      const fieldsConf = this.parseFieldsConf(actionData.transformAction.fieldsConf);
      transformAction = new TransformAction(fieldsConf);
    }

    let importAction: ImportAction | undefined = undefined;
    if (
      actionData?.importAction?.objectName ||
      actionData?.importAction?.uniqueField ||
      actionData?.importAction?.action
    ) {
      const objectName = actionData.importAction.objectName ?? null;
      const uniqueField = actionData.importAction.uniqueField ?? null;
      const action = actionData.importAction.action ?? null;

      // Parse importFields as array of strings for ImportAction
      let importFields: string[] = [];
      if (Array.isArray(actionData.importAction.importFields)) {
        importFields = actionData.importAction.importFields.map((field: any) =>
          typeof field === 'string'
            ? field
            : (field?.name ?? '')
        ).filter((field: string) => field.length > 0);
      }

      if (objectName && action) {
        importAction = new ImportAction(objectName, uniqueField, action, importFields);
      }
    }

    // Parse copySheetAction if present
    let copySheetAction: CopySheetAction | undefined = undefined;
    if (actionData?.copySheetAction?.copyFields) {
      let copyFields: SheetField[] = [];
      if (Array.isArray(actionData.copySheetAction.copyFields)) {
        copyFields = actionData.copySheetAction.copyFields.map((field: any) => {
          const name = field?.name ?? '';
          const apiName = field?.apiName ?? name;
          return new SheetField(name, apiName);
        });
      }
      copySheetAction = new CopySheetAction(copyFields);
    }

    // Parse inputSheet (required) and outputSheet (optional)
    const inputSheet = actionData?.inputSheet ?? null;
    let outputSheet = actionData?.outputSheet ?? inputSheet;

    // Parse exportAction if present
    let exportAction: ExportAction | undefined = undefined;
    if (actionData?.exportAction?.query) {
      const uniqueField = actionData.exportAction.uniqueField ?? undefined;
      exportAction = new ExportAction(actionData.exportAction.query, uniqueField);
    }

    return new Action(
      name,
      inputSheet,
      outputSheet,
      waitStartingTime,
      transformAction,
      importAction,
      exportAction,
      copySheetAction 
    );
  }

  private static parseFieldsConf(fieldsConfData: any[]): TransformFieldConf[] {
    if (!Array.isArray(fieldsConfData)) {
      return [];
    }
    return fieldsConfData.map(fieldConfData => this.parseFieldConf(fieldConfData));
  }

  private static parseFieldConf(fieldConfData: any): TransformFieldConf {
    const name = fieldConfData?.name ?? null;
    const transformation = fieldConfData?.transformation ?? null;
    return new TransformFieldConf(name, transformation);
  }
}