import { Action } from '../model/Action';
import { DataSheet } from '../model/DataSheet';
import { DataSheetProcessor } from './DataSheetProcessor';
import { ExecConf } from '../model/ExecConf';
import { SalesforceBulkApiLoader } from '../salesforce/SalesforceBulkApiLoader';
import { SalesforceAuthenticator } from '../salesforce/SalesforceAuthenticator';
import { ImportAction } from '../model/ImportAction';

export class ActionProcessor {
  /**
   * Processes a list of actions: executes transformation and import for each action if configured.
   * @param execConf The execution configuration (needed for import).
   * @param sheetsData Dictionary of DataSheet objects.
   */
  static async processActions(
    execConf: ExecConf,
    sheetsData: { [sheetName: string]: DataSheet },
  ): Promise<void> {
    for (const action of execConf.actions) {
      if (action.waitStartingTime > 0) {
        console.log(`Waiting ${action.waitStartingTime} ms before processing action "${action.name}"...`);
        await new Promise(resolve => setTimeout(resolve, action.waitStartingTime * 1000));
      }

      const inputSheetName = action.inputSheet;
      const outputSheetName = action.outputSheet || inputSheetName;

      // 1. CopySheetAction
      let resultOk = await this.executeCopySheetAction(action, sheetsData, inputSheetName, outputSheetName);
      if (!resultOk) {
        return;
      }

      // 2. ExportAction
      resultOk = await this.executeExportAction(execConf, action, sheetsData, outputSheetName);
      if (!resultOk) {
        return;
      }

      // 3. Transformation
      resultOk = await this.executeTransformAction(execConf, action, sheetsData, inputSheetName);
      if (!resultOk) {
        return;
      }

      // 4. ImportAction
      resultOk = await this.executeImportAction(execConf, action, sheetsData, inputSheetName, outputSheetName);
      if (!resultOk) {
        return;
      }
    }
  }

  private static async executeCopySheetAction(
    action: Action,
    sheetsData: { [sheetName: string]: DataSheet },
    inputSheetName: string,
    outputSheetName: string
  ): Promise<boolean> {
    if (!action.copySheetAction || action.copySheetAction.copyFields.length === 0) {
      return true;
    }

    const dataSheet = sheetsData[inputSheetName];
    if (!dataSheet) {
      console.error(`Input DataSheet "${inputSheetName}" not found for copySheetAction.`);
      return false;
    }

    // Build new DataSheet with only the specified fields (by name), but use apiName for the output fieldNames
    const fieldIndexes = action.copySheetAction.copyFields.map(
      field => dataSheet.fieldNames.indexOf(field.name)
    );
    const validFields = action.copySheetAction.copyFields
      .map((field, i) => ({ idx: fieldIndexes[i], apiName: field.apiName }))
      .filter(f => f.idx !== -1);

    const newFieldNames = validFields.map(f => f.apiName);
    const newData = dataSheet.data.map(row =>
      validFields.map(f => row[f.idx])
    );

    const newSheet: DataSheet = {
      name: outputSheetName,
      fieldNames: newFieldNames,
      data: newData,
    };
    sheetsData[outputSheetName] = newSheet;
    console.log(`Copied fields [${newFieldNames.join(', ')}] from "${inputSheetName}" to "${outputSheetName}".`);

    return true;
  }

  private static async executeExportAction(
    execConf: ExecConf,
    action: Action,
    sheetsData: { [sheetName: string]: DataSheet },
    outputSheetName: string
  ): Promise<boolean> {
    if (!action.exportAction) {
      return true;
    }

    console.log(`Exporting data for "${outputSheetName}" from Salesforce...`);
    try {
      const conn = await SalesforceAuthenticator.authenticate();
      if (!conn || !conn.accessToken) {
        throw new Error('Salesforce authentication failed. No connection object returned.');
      }
      const apiBulkLoader = new SalesforceBulkApiLoader(execConf.appConfiguration);
      const exportDataSheet = await apiBulkLoader.bulkApiQuery(
        conn.instanceUrl,
        conn.accessToken,
        action.exportAction,
        outputSheetName
      );

      // Overwrite or create the output sheet
      sheetsData[outputSheetName] = exportDataSheet;
      console.log(`Exported data for "${outputSheetName}" loaded into sheetsData.`);
    } catch (error: any) {
      console.error(`Error exporting data for "${outputSheetName}": ${error.message}`);
      if (execConf.appConfiguration.stopOnError) {
        await ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, true);
        return false;
      }
    }

    return true;
  }

  private static async executeTransformAction(
    execConf: ExecConf,
    action: Action,
    sheetsData: { [sheetName: string]: DataSheet },
    inputSheetName: string
  ): Promise<boolean> {
    const dataSheet = sheetsData[inputSheetName];
    if (!dataSheet) {
      if (action.transformAction) {
        console.error(`DataSheet "${inputSheetName}" not found. Skipping transformation.`);
      }
      return true;
    }

    if (action.transformAction && action.transformAction.fieldsConf) {
      console.log(`Processing transformation for DataSheet "${inputSheetName}"...`);
      try {
        DataSheetProcessor.processDataSheet(dataSheet, action.transformAction, sheetsData);
      } catch (error: any) {
        console.error(`Error processing transformation for DataSheet "${inputSheetName}": ${error.message}`);
        if (execConf.appConfiguration.stopOnError) {
          await ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, true);
          return false;
        }
      }
    }

    return true;
  }

  private static async executeImportAction(
    execConf: ExecConf,
    action: Action,
    sheetsData: { [sheetName: string]: DataSheet },
    inputSheetName: string,
    outputSheetName: string
  ): Promise<boolean> {
    if (!action.importAction) {
      return true;
    }

    const dataSheet = sheetsData[inputSheetName];
    if (!dataSheet) {
      console.error(`DataSheet "${inputSheetName}" not found. Skipping import.`);
      return execConf.appConfiguration.stopOnError ? false : true;
    }

    console.log(`Importing DataSheet "${inputSheetName}" to Salesforce...`);
    try {
      const conn = await SalesforceAuthenticator.authenticate();
      if (!conn || !conn.accessToken) {
        throw new Error('Salesforce authentication failed. No connection object returned.');
      }

      const apiBulkLoader = new SalesforceBulkApiLoader(execConf.appConfiguration);

      // If outputSheetName is defined and different from inputSheetName, clone the input sheet for output
      let importDataSheet: DataSheet = dataSheet;
      if (outputSheetName && outputSheetName !== inputSheetName) {
        importDataSheet = DataSheetProcessor.cloneDataSheet(dataSheet, outputSheetName);
        sheetsData[outputSheetName] = importDataSheet;
      }

      let resultSheet = await apiBulkLoader.bulkApiOperation(
        conn.instanceUrl,
        conn.accessToken,
        action.importAction,
        importDataSheet
      );

      console.log(`Data loading for sheet "${outputSheetName}" completed${resultSheet ? '' : ' with errors'}.`);

      if (!resultSheet && execConf.appConfiguration.stopOnError) {
        throw new Error(`Errors loading data for sheet "${outputSheetName}". Stopping further processing.`);
      }
    } catch (error: any) {
      console.error(`Error loading data for sheet "${outputSheetName}": ${error.message}`);
      if (execConf.appConfiguration.stopOnError) {
        ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, true);
        return false
      }
    }

    return true;
  }

  private static async executeRollbackOnError(
    execConf: ExecConf,
    sheetsData: { [sheetName: string]: DataSheet },
    action: Action,
    includeAction: boolean
  ): Promise<void> {
    if (execConf.appConfiguration.rollbackOnError) {
      console.error(`Rolling back changes from action "${action.name}".`);
      const indexAction = execConf.actions.indexOf(action) + (includeAction ? 0 : -1);

      // Generate a rollback execConf with only delete actions
      const rollbackExecConf = ActionProcessor.generateRollbackExecConf(execConf);
      rollbackExecConf.actions = this.generateRollbackActions(execConf.actions, indexAction);

      // process rollback actions
      await this.processActions(rollbackExecConf, sheetsData);
    }
  }

  private static generateRollbackExecConf(execConf: ExecConf): ExecConf {
    const execConfRollback = new ExecConf(
      execConf.appConfiguration,
      [],
      []
    );
    execConfRollback.appConfiguration.stopOnError = false;
    execConfRollback.appConfiguration.rollbackOnError = false;
    return execConfRollback;
  }

  /**
   * Generates a new array of actions for rollback (delete) from the given actions array,
   * starting from the given index and going backwards to 0.
   * Each new action will have only an ImportAction with action="delete".
   * The transformAction will be omitted.
   * @param actions The original array of actions.
   * @param index The index to start the rollback from.
   * @returns An array of rollback (delete) actions.
   */
  private static generateRollbackActions(actions: Action[], index: number): Action[] {
    const rollbackActions: Action[] = [];
    for (let i = index; i >= 0; i--) {
      const action = actions[i];
      if (action.importAction) {
        const importName = action.importAction.objectName;
        // Create a new ImportAction for delete
        const deleteImportAction = new ImportAction(
          importName,
          '',
          'delete',
          []
        );
        // Create a new Action with only the delete ImportAction
        rollbackActions.push(new Action(action.name, action.outputSheet, action.outputSheet, 0, undefined, deleteImportAction));
      }
    }
    return rollbackActions;
  }

}