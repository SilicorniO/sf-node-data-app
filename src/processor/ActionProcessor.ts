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
   * @param actions Array of Action objects to process.
   * @param sheetsData Dictionary of DataSheet objects.
   * @param execConf The execution configuration (needed for import).
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

      // Export
      if (action.exportAction) {
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
            ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, true);
            return;
          }
        }
      }

      // Check if the input DataSheet exists
      const dataSheet = sheetsData[inputSheetName];
      if (!dataSheet) {
        if (action.transformAction || action.importAction) {
          console.error(`DataSheet "${inputSheetName}" not found. Skipping transformation and import.`);
        }
        continue;
      }

      // Transformation
      if (action.transformAction && action.transformAction.fieldsConf) {
        console.log(`Processing transformation for DataSheet "${inputSheetName}"...`);
        try {
          DataSheetProcessor.processDataSheet(dataSheet, action.transformAction, sheetsData);
        } catch (error: any) {
          console.error(`Error processing transformation for DataSheet "${inputSheetName}": ${error.message}`);
          if (execConf.appConfiguration.stopOnError) {
            ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, true);
            return;
          }
        }
      }

      // Import
      if (action.importAction) {
        console.log(`Importing DataSheet "${inputSheetName}" to Salesforce...`);
        try {
          const conn = await SalesforceAuthenticator.authenticate();
          if (!conn || !conn.accessToken) {
            throw new Error('Salesforce authentication failed. No connection object returned.');
          }

          const apiBulkLoader = new SalesforceBulkApiLoader(execConf.appConfiguration);

          // If outputSheetName is defined and different from inputSheetName, clone the input sheet for output
          let importDataSheet: DataSheet = dataSheet
          if (outputSheetName && outputSheetName !== inputSheetName) {
            sheetsData[outputSheetName] = DataSheetProcessor.cloneDataSheet(dataSheet, outputSheetName);
          }

          let executionOk = await apiBulkLoader.bulkApiOperation(
            conn.instanceUrl,
            conn.accessToken,
            action.importAction,
            importDataSheet
          );
          console.log(`Data loading for sheet "${outputSheetName}" completed.`);

          if (!executionOk && execConf.appConfiguration.stopOnError) {
            console.error(`Errors loading data for sheet "${outputSheetName}". Stopping further processing.`);
            if (execConf.appConfiguration.rollbackOnError) {
              ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, false);
            }
            return;
          }
        } catch (error: any) {
          console.error(`Error loading data for sheet "${outputSheetName}": ${error.message}`);
          if (execConf.appConfiguration.stopOnError) {
            ActionProcessor.executeRollbackOnError(execConf, sheetsData, action, true);
            return;
          }
        }
      }
    }
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
      await this.processActions(execConf, sheetsData);
    }
  }

  private static generateRollbackExecConf(execConf: ExecConf): ExecConf {
    const execConfRollback = new ExecConf(
      execConf.appConfiguration,
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