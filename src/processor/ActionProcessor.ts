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
    actions: Action[],
    sheetsData: { [sheetName: string]: DataSheet },
    execConf: ExecConf
  ): Promise<void> {
    for (const action of actions) {
      // wait startingtime of the action
      if (action.waitStartingTime > 0) {
        console.log(`Waiting ${action.waitStartingTime} ms before processing action "${action.name}"...`);
        await new Promise(resolve => setTimeout(resolve, action.waitStartingTime * 1000));
      }

      // Export
      const sheetName = action.name;
      if (action.exportAction) {
        console.log(`Exporting data for "${sheetName}" from Salesforce...`);
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
            sheetName
          );
          // If sheet doesn't exist, create it
          if (!sheetsData[sheetName]) {
            sheetsData[sheetName] = exportDataSheet;
          } else {
            // Merge the new data with the existing DataSheet
            sheetsData[sheetName] = DataSheetProcessor.mergeDataSheets(exportDataSheet, sheetsData[sheetName], action.exportAction.uniqueColumn);
          }
          console.log(`Exported data for "${sheetName}" loaded into sheetsData.`);
        } catch (error: any) {
          console.error(`Error exporting data for "${sheetName}": ${error.message}`);
          if (execConf.appConfiguration.stopOnError) {
            if (execConf.appConfiguration.rollbackOnError) {
              console.error(`Rolling back changes from sheet "${sheetName}".`);
              const rollbackActions = this.generateRollbackActions(actions, actions.indexOf(action) - 1);
              await this.processActions(rollbackActions, sheetsData, execConf);
            }
            return;
          }
        }
      }

      // Check if the DataSheet exists
      const dataSheet = sheetsData[sheetName];
      if (!dataSheet) {
        console.warn(`DataSheet "${sheetName}" not found. Skipping action.`);
        continue;
      }

      // Transformation
      if (action.transformAction && action.transformAction.fieldsConf) {
        console.log(`Processing transformation for DataSheet "${sheetName}"...`);
        try {
          DataSheetProcessor.processDataSheet(dataSheet, action.transformAction, sheetsData);
        }catch (error: any) {
          console.error(`Error processing transformation for DataSheet "${sheetName}": ${error.message}`);
          if (execConf.appConfiguration.stopOnError) {
            if (execConf.appConfiguration.rollbackOnError) {
              console.error(`Rolling back changes from sheet "${sheetName}".`);
              const rollbackActions = this.generateRollbackActions(actions, actions.indexOf(action) - 1);
              await this.processActions(rollbackActions, sheetsData, execConf);
            }
            return;
          }
        }
      }

      // Import
      if (action.importAction) {
        console.log(`Importing DataSheet "${sheetName}" to Salesforce...`);
        try {
          //get authentication
          const conn = await SalesforceAuthenticator.authenticate();
          if (!conn || ! conn.accessToken) {
            throw new Error('Salesforce authentication failed. No connection object returned.');
          }

          // Load data using Bulk API v2
          const apiBulkLoader = new SalesforceBulkApiLoader(execConf.appConfiguration);
          let executionOk;
          if (action.importAction.action == "insert") {
            executionOk = await apiBulkLoader.bulkApiOperation(conn.instanceUrl, conn.accessToken, action.importAction, dataSheet);
          } else if (action.importAction.action == "delete") {
            executionOk = await apiBulkLoader.bulkApiOperation(conn.instanceUrl, conn.accessToken, action.importAction, dataSheet);
          }
          console.log(`Data loading for sheet "${sheetName}" completed.`);

          if (!executionOk && execConf.appConfiguration.stopOnError) {
            console.error(`Errors loading data for sheet "${sheetName}". Stopping further processing.`);
            if (execConf.appConfiguration.rollbackOnError) {
              console.error(`Rolling back changes from sheet "${sheetName}".`);
              const rollbackActions = this.generateRollbackActions(actions, actions.indexOf(action));
              await this.processActions(rollbackActions, sheetsData, execConf);
            }
            return;
          }
        } catch (error: any) {
          console.error(`Error loading data for sheet "${sheetName}": ${error.message}`);
          if (execConf.appConfiguration.stopOnError) {
            if (execConf.appConfiguration.rollbackOnError) {
              console.error(`Rolling back changes from sheet "${sheetName}".`);
              const rollbackActions = this.generateRollbackActions(actions, actions.indexOf(action) - 1);
              await this.processActions(rollbackActions, sheetsData, execConf);
            }
            return;
          }
        }
      }
    }
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
    const original = actions[i];
    if (original.importAction) {
      const importName = original.importAction.objectName;
      // Create a new ImportAction for delete
      const deleteImportAction = new ImportAction(
        importName,
        '',
        'delete',
        []
      );
      // Create a new Action with only the delete ImportAction
      rollbackActions.push(new Action(original.name, 0, undefined, deleteImportAction));
    }
  }
  return rollbackActions;
}

}