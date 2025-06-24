import axios from 'axios';
import { AppConfiguration } from '../model/AppConfiguration';
import { DataSheet } from '../model/DataSheet';
import { ImportAction, ActionType } from '../model/ImportAction';
import { ExportAction } from '../model/ExportAction';

const ID_COLUMN = 'Id';
const ERROR_INSERT_MESSAGE_LABEL = '_ErrorInsertMessage';
const ERROR_REMOVE_MESSAGE_LABEL = '_ErrorRemoveMessage';
const MAX_COMPOSITE_BATCH_SIZE = 500;

export class SalesforceApiLoader {
  appConfiguration: AppConfiguration;

  constructor(appConfiguration: AppConfiguration) {
    this.appConfiguration = appConfiguration;
  }

  private getAxiosInstance(instanceUrl: string, accessToken: string) {
    return axios.create({
      baseURL: `${instanceUrl}/services/data/v${this.appConfiguration.apiVersion}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Generates the payload for the composite API based on the operation.
   */
  private generateCompositePayload(
    operation: ActionType,
    dataSheet: DataSheet,
    importAction: ImportAction
  ): any[] {
    const indexIdField = dataSheet.fieldNames.indexOf(ID_COLUMN);
    let validIndexes: number[] = [];
    let headers: string[] = [];

    if (importAction.importFields && importAction.importFields.length > 0) {
      if (indexIdField >= 0 && !importAction.importFields.includes(ID_COLUMN)) {
        validIndexes.push(indexIdField);
        headers.push(ID_COLUMN);
      }
      importAction.importFields.forEach(importField => {
        const idx = dataSheet.fieldNames.indexOf(importField);
        if (idx !== -1) {
          validIndexes.push(idx);
          headers.push(importField);
        }
      });
    } else {
      dataSheet.fieldNames.forEach((col, idx) => {
        if (col && col.trim() !== '') {
          validIndexes.push(idx);
          headers.push(col);
        }
      });
    }

    let filteredData = dataSheet.data;
    if (operation === 'insert' && indexIdField >= 0) {
      filteredData = filteredData.filter(row => !row[indexIdField]);
    }

    return filteredData.map(row => {
      const obj: any = {};
      headers.forEach((header, i) => {
        obj[header] = row[validIndexes[i]];
      });
      return obj;
    });
  }

  /**
   * Loads data into Salesforce using the Composite API for insert, update, upsert, or delete.
   * Returns a new DataSheet with results, or null on error.
   */
  public async apiOperation(
    instanceUrl: string,
    accessToken: string,
    importAction: ImportAction,
    dataSheet: DataSheet
  ): Promise<boolean> {
    try {
      const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);
      const records = this.generateCompositePayload(importAction.action, dataSheet, importAction);

      if (records.length === 0) {
        console.info(`No data to import for ${dataSheet.name}.`);
        return true;
      }

      // Add error column if not present
      let errorColIdx = dataSheet.fieldNames.indexOf(
        importAction.action === 'delete'
          ? ERROR_REMOVE_MESSAGE_LABEL
          : ERROR_INSERT_MESSAGE_LABEL
      );
      if (errorColIdx === -1) {
        errorColIdx = dataSheet.fieldNames.length;
        dataSheet.fieldNames.push(
          importAction.action === 'delete'
            ? ERROR_REMOVE_MESSAGE_LABEL
            : ERROR_INSERT_MESSAGE_LABEL
        );
        dataSheet.data.forEach(row => row.push(''));
      }

      // Add Id column for insert if not present
      let idColIdx = dataSheet.fieldNames.indexOf(ID_COLUMN);
      if (importAction.action === 'insert' && idColIdx === -1) {
        idColIdx = dataSheet.fieldNames.length;
        dataSheet.fieldNames.push(ID_COLUMN);
        dataSheet.data.forEach(row => row.push(''));
      }

      let hasErrors = false;

      // Process in batches of 500
      for (let i = 0; i < records.length; i += MAX_COMPOSITE_BATCH_SIZE) {
        const batch = records.slice(i, i + MAX_COMPOSITE_BATCH_SIZE);

        // Build compositeRequest array
        const compositeRequest = batch.map((record, idx) => {
          let method = '';
          let url = `/services/data/v${this.appConfiguration.apiVersion}`;
          let body = {};
          let referenceId = `ref${importAction.objectName}${i + idx}`;

          switch (importAction.action) {
            case 'insert':
              method = 'POST';
              url += `/sobjects/${importAction.objectName}`;
              body = record;
              break;
            case 'update':
              method = 'PATCH';
              url += `/sobjects/${importAction.objectName}/${record[ID_COLUMN]}`;
              body = record;
              break;
            case 'upsert':
              method = 'PATCH';
              url += `/sobjects/${importAction.objectName}/${importAction.uniqueField}/${record[importAction.uniqueField]}`;
              body = record;
              break;
            case 'delete':
              method = 'DELETE';
              url += `/sobjects/${importAction.objectName}/${record[ID_COLUMN]}`;
              body = {};
              break;
          }

          return {
            method,
            url,
            referenceId,
            ...(method !== 'DELETE' ? { body } : {})
          };
        });

        let response;
        try {
          response = await axiosInstance.post(
            '/composite',
            { compositeRequest, allOrNone: false }
          );
        } catch (error: any) {
          const errorDetails = this.readApiErrors(error);
          throw new Error(`Error during Composite API ${importAction.action} operation: ${errorDetails}`);
        }

        // Process results
        const data: any = response.data;
        if (Array.isArray(data.compositeResponse)) {
          data.compositeResponse.forEach((res: any, idx: number) => {
            const dataIdx = i + idx;
            // For insert, set the returned Id
            if (importAction.action === 'insert' && res.body && res.body.id && idColIdx !== -1) {
              dataSheet.data[dataIdx][idColIdx] = res.body.id;
            }
            // For errors, res.body is an array of error objects
            if (
              res.httpStatusCode >= 400 &&
              Array.isArray(res.body) &&
              res.body.length > 0
            ) {
              dataSheet.data[dataIdx][errorColIdx] = res.body.map((e: any) => e.message).join(' | ');
              hasErrors = true;
            }
            // For upsert/update, errors may also be in res.body.errors
            if (
              (importAction.action === 'update' || importAction.action === 'upsert') &&
              res.body &&
              Array.isArray(res.body.errors) &&
              res.body.errors.length > 0
            ) {
              dataSheet.data[dataIdx][errorColIdx] = res.body.errors.map((e: any) => e.message).join(' | ');
              hasErrors = true;
            }
          });
        }
      }

      return !hasErrors;
    } catch (error: any) {
      const errorDetails = this.readApiErrors(error);
      throw new Error(`Error during Composite API ${importAction.action} operation: ${errorDetails}`);
    }
  }

  /**
   * Executes a SOQL query using the REST API and returns the results as a DataSheet.
   * Handles pagination with queryLocator for large result sets.
   */
  public async apiQuery(
    instanceUrl: string,
    accessToken: string,
    exportAction: ExportAction,
    name: string
  ): Promise<DataSheet> {
    const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);
    let url = `/query?q=${encodeURIComponent(exportAction.query)}`;
    let allRecords: any[] = [];
    let fieldNames: string[] = [];

    while (url) {
      let response;
      try {
        response = await axiosInstance.get(url);
      } catch (error: any) {
        const errorDetails = this.readApiErrors(error);
        throw new Error(`Error during Query API export: ${errorDetails}`);
      }

      const data: any = response.data;
      // Remove Salesforce "attributes" property from each record
      const records = Array.isArray(data.records)
        ? data.records.map((rec: any) => {
            const { attributes, ...rest } = rec;
            return rest;
          })
        : [];

      if (allRecords.length === 0 && records.length > 0) {
        fieldNames = Object.keys(records[0]);
      }
      allRecords = allRecords.concat(records);

      // If there are more records, continue with nextRecordsUrl
      url = data.nextRecordsUrl
        ? data.nextRecordsUrl.replace(/^\/services\/data\/v[\d.]+\//, '/')
        : '';
    }

    const rows = allRecords.map(rec =>
      fieldNames.map(f => rec[f] !== undefined ? String(rec[f]) : '')
    );
    return {
      name,
      fieldNames,
      data: rows,
    };
  }

  private readApiErrors(error: any): string {
    if (error?.response?.data && Array.isArray(error.response.data)) {
      return error.response.data
        .map((err: any) => `[${err.errorCode}] ${err.message}`)
        .join(' | ');
    }
    if (error?.response?.data && error.response.data.error && error.response.data.error_description) {
      return `[${error.response.data.error}] ${error.response.data.error_description}`;
    }
    return error?.message || 'Unknown error';
  }
}