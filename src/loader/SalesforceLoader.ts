// src/loader/SalesforceLoader.ts
import { Connection } from 'jsforce';
import { SalesforceAuthenticator } from '../salesforce/SalesforceAuthenticator';
import { SalesforceBulkApiLoader } from '../salesforce/SalesforceBulkApiLoader';
import { ExecConf } from '../model/ExecConf';
import { DataSheet } from '../model/DataSheet';
import { DataSheetProcessor } from '../processor/DataSheetProcessor';

export class SalesforceLoader {
  /**
   * Loads data from the DataSheet objects into Salesforce, as defined in the ExecConf.
   * @param execConf The execution configuration object.
   * @param sheetsData An object containing the DataSheet objects, keyed by sheet name.
   */
  static async loadData(execConf: ExecConf, sheetsData: { [sheetName: string]: DataSheet }): Promise<void> {
    try {
      // 1. Authenticate with Salesforce
      const conn = await SalesforceAuthenticator.authenticate();
      if (!conn || ! conn.accessToken) {
        throw new Error('Salesforce authentication failed. No connection object returned.');
      }

      // 2. Iterate through ObjectConf and load data for each sheet
      for (const objectConf of execConf.objectsConf) {
        if (objectConf.name && objectConf.sfObject) {
          const sheetName = objectConf.name;
          const dataSheet = sheetsData[sheetName];
          if (dataSheet) {
            console.log(`Evaluating data for sheet "${sheetName}" to Salesforce object "${objectConf.sfObject}"...`);
            DataSheetProcessor.processDataSheet(dataSheet, objectConf, sheetsData); // Process the DataSheet

            console.log(`Loading data for sheet "${sheetName}" to Salesforce object "${objectConf.sfObject}"...`);
            try {
              // Load data using Bulk API v2
              const apiBulkLoader = new SalesforceBulkApiLoader(execConf.importConf);
              const updatedDataSheet = await apiBulkLoader.loadDataWithBulkAPI(conn.instanceUrl, conn.accessToken, objectConf, dataSheet);
              sheetsData[sheetName] = updatedDataSheet; // Store modified DataSheet
              console.log(`Data loading for sheet "${sheetName}" completed.`);
            } catch (error: any) {
              console.error(`Error loading data for sheet "${sheetName}":`, error);
              // Consider how to handle errors: continue, rethrow, etc.  For now, continue.
            }
          } else {
            console.warn(`Sheet "${sheetName}" not found in Excel data. Skipping.`);
          }
        } else {
          console.warn(`ObjectConf for sheet "${objectConf.name}" is missing required fields (name or sfObject). Skipping.`);
        }
      }
    } catch (error: any) {
      throw new Error(`Failed to load data into Salesforce: ${error.message}`);
    }
  }
}
