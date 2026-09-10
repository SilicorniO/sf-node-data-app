import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Action } from '../model/Action';
import { TransformAction } from '../model/TransformAction';
import { GetAction } from '../model/GetAction';
import { InsertAction } from '../model/InsertAction';
import { UpdateAction } from '../model/UpdateAction';
import { UpsertAction } from '../model/UpsertAction';
import { DeleteAction } from '../model/DeleteAction';
import { MergeAction } from '../model/MergeAction';
import { CheckAction } from '../model/CheckAction';
import { AppConfiguration } from '../model/AppConfiguration';
import { ExecConf } from '../model/ExecConf';
import { SheetConf } from '../model/SheetConf';
import { SheetField } from '../model/SheetField';
import { execConfSchema, ParsedExecConf } from '../schema/ExecConfSchema';
import { ZodError } from 'zod';

export class ExecConfReader {
  /**
   * Reads a YAML config file from disk and parses it into an ExecConf.
   * @param confFilePath Path to the YAML configuration file.
   * @param scriptFilePath Optional path to the shared transform script, supplied on the CLI
   *   (`--scriptFile`). Resolved relative to the current working directory by the caller.
   */
  static readConfFile(confFilePath: string, scriptFilePath?: string): ExecConf {
    try {
      const resolvedPath = path.resolve(confFilePath);
      const confFileContent = fs.readFileSync(resolvedPath, 'utf8');
      return ExecConfReader.parseConf(confFileContent, scriptFilePath);
    } catch (error: any) {
      throw new Error(`Error reading or parsing configuration file: ${error.message}`);
    }
  }

  /**
   * Parses a YAML string into an ExecConf.
   * This method has no file-system dependency and can be used in the browser.
   * @param scriptFilePath Optional path to the shared transform script (from `--scriptFile`).
   */
  static parseConf(yamlString: string, scriptFilePath?: string): ExecConf {
    try {
      const rawConfiguration = yaml.load(yamlString);
      const configuration = execConfSchema.parse(rawConfiguration);
      const resolvedScriptPath = scriptFilePath ? path.resolve(scriptFilePath) : undefined;
      return new ExecConf(
        this.parseAppConfiguration(configuration),
        configuration.actions.map(action => this.parseAction(action, resolvedScriptPath)),
        configuration.sheets.map(sheet => new SheetConf(
          sheet.name,
          sheet.fields.map(field => new SheetField(field.name, field.apiName ?? field.name))
        ))
      );
    } catch (error: any) {
      if (error instanceof ZodError) {
        const details = error.issues
          .map(issue => `${issue.path.join('.') || 'configuration'}: ${issue.message}`)
          .join('; ');
        throw new Error(`Error parsing configuration: ${details}`);
      }
      throw new Error(`Error parsing configuration: ${error.message}`);
    }
  }

  private static parseAppConfiguration(configuration: ParsedExecConf): AppConfiguration {
    const app = configuration.appConfiguration;
    return new AppConfiguration(
      app.processingType,
      app.bulkApiMaxWaitSec,
      app.bulkApiPollIntervalSec,
      app.apiVersion,
      app.cleanOutputFolderBeforeExecution,
      app.deleteErrorFilesBeforeExecution,
      app.queryApiBatchSize,
      app.autoBulkThreshold
    );
  }

  private static parseAction(action: ParsedExecConf['actions'][number], scriptFilePath?: string): Action {
    const options = {
      waitBeforeSeconds: action.waitBeforeSeconds,
      continueOnError: action.continueOnError,
      errorSheet: action.errorSheet,
      errorRows: action.errorRows,
    };

    switch (action.type) {
      case 'get':
        return new GetAction(action.name, action.outputSheet, action.query, options);
      case 'insert':
        return new InsertAction(action.name, action.object, action.inputSheet, action.fields, action.outputSheet, options);
      case 'update':
        return new UpdateAction(action.name, action.object, action.inputSheet, action.fields, options);
      case 'upsert':
        return new UpsertAction(action.name, action.object, action.inputSheet, action.fields, action.externalIdField, options);
      case 'delete':
        return new DeleteAction(action.name, action.object, action.inputSheet, options);
      case 'merge':
        return new MergeAction(
          action.name,
          action.primarySheet,
          action.secondarySheet,
          action.outputSheet,
          action.idField,
          options
        );
      case 'transform':
        if (!scriptFilePath) {
          throw new Error(`Transform action "${action.name}" requires a shared script; pass it with --scriptFile.`);
        }
        return new TransformAction(
          action.name,
          action.inputSheet,
          action.outputSheet,
          scriptFilePath,
          options
        );
      case 'check':
        if (!scriptFilePath) {
          throw new Error(`Check action "${action.name}" requires a shared script; pass it with --scriptFile.`);
        }
        return new CheckAction(action.name, action.inputSheets, scriptFilePath, options);
    }
  }
}