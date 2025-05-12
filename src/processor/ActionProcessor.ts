import { Action } from '../model/Action';
import { DataSheet } from '../model/DataSheet';
import { DataSheetProcessor } from './DataSheetProcessor';
import { ExecConf } from '../model/ExecConf';
import { SalesforceBulkApiLoader } from '../salesforce/SalesforceBulkApiLoader';
import { SalesforceAuthenticator } from '../salesforce/SalesforceAuthenticator';

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
      const sheetName = action.name;
      const dataSheet = sheetsData[sheetName];
      if (!dataSheet) {
        console.warn(`DataSheet "${sheetName}" not found. Skipping action.`);
        continue;
      }

      // 1. Transformation
      if (action.transformAction && action.transformAction.fieldsConf) {
        console.log(`Processing transformation for DataSheet "${sheetName}"...`);
        DataSheetProcessor.processDataSheet(dataSheet, action.transformAction, sheetsData);
      }

      // 2. Import
      if (action.importAction) {
        console.log(`Importing DataSheet "${sheetName}" to Salesforce...`);
        try {
          //get authentication
          const conn = await SalesforceAuthenticator.authenticate();
          if (!conn || ! conn.accessToken) {
            throw new Error('Salesforce authentication failed. No connection object returned.');
          }

          // Load data using Bulk API v2
          const apiBulkLoader = new SalesforceBulkApiLoader(execConf.importConf);
          const insertedOk = await apiBulkLoader.insertDataWithBulkAPI(conn.instanceUrl, conn.accessToken, action.importAction, dataSheet);
          console.log(`Data loading for sheet "${sheetName}" completed.`);

          if (!insertedOk && execConf.importConf.stopOnError) {
            console.error(`Errors inserting data for sheet "${sheetName}". Stopping further processing.`);
            if (execConf.importConf.rollbackOnError) {
              console.error(`WIP: Rolling back changes from sheet "${sheetName}".`);
            }
            return;
          }

        } catch (error: any) {
          console.error(`Error loading data for sheet "${sheetName}":`, error);
          // Consider how to handle errors: continue, rethrow, etc.  For now, continue.
        }
      }
    }
  }


}