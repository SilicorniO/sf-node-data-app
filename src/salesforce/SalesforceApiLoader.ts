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
  ): Promise<DataSheet | null> {
    try {
      const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);
      const records = this.generateCompositePayload(importAction.action, dataSheet, importAction);

      if (records.length === 0) {
        console.info(`No data to import for ${dataSheet.name}.`);
        return {
          name: dataSheet.name,
          fieldNames: [...dataSheet.fieldNames],
          data: dataSheet.data.map(row => [...row]),
        };
      }

      // Prepare result DataSheet
      const resultDataSheet: DataSheet = {
        name: dataSheet.name,
        fieldNames: [...dataSheet.fieldNames],
        data: dataSheet.data.map(row => [...row]),
      };

      // Add error column if not present
      let errorColIdx = resultDataSheet.fieldNames.indexOf(
        importAction.action === 'delete'
          ? ERROR_REMOVE_MESSAGE_LABEL
          : ERROR_INSERT_MESSAGE_LABEL
      );
      if (errorColIdx === -1) {
        errorColIdx = resultDataSheet.fieldNames.length;
        resultDataSheet.fieldNames.push(
          importAction.action === 'delete'
            ? ERROR_REMOVE_MESSAGE_LABEL
            : ERROR_INSERT_MESSAGE_LABEL
        );
        resultDataSheet.data.forEach(row => row.push(''));
      }

      // Add Id column for insert if not present
      let idColIdx = resultDataSheet.fieldNames.indexOf(ID_COLUMN);
      if (importAction.action === 'insert' && idColIdx === -1) {
        idColIdx = resultDataSheet.fieldNames.length;
        resultDataSheet.fieldNames.push(ID_COLUMN);
        resultDataSheet.data.forEach(row => row.push(''));
      }

      // Process in batches of 500
      for (let i = 0; i < records.length; i += MAX_COMPOSITE_BATCH_SIZE) {
        const batch = records.slice(i, i + MAX_COMPOSITE_BATCH_SIZE);

        let url = '';
        let method = '';
        let body: any = {};

        switch (importAction.action) {
          case 'insert':
            url = `/sobjects/${importAction.objectName}`;
            method = 'POST';
            body = { records: batch };
            break;
          case 'update':
            url = `/composite/sobjects`;
            method = 'PATCH';
            body = { allOrNone: false, records: batch };
            break;
          case 'upsert':
            url = `/composite/sobjects/${importAction.objectName}/${importAction.uniqueField}`;
            method = 'PATCH';
            body = { allOrNone: false, records: batch };
            break;
          case 'delete':
            url = `/composite/sobjects`;
            method = 'DELETE';
            body = { ids: batch.map(r => r[ID_COLUMN]) };
            break;
        }

        let response;
        try {
          response = await axiosInstance.request({
            url,
            method,
            data: body,
          });
        } catch (error: any) {
          const errorDetails = this.readApiErrors(error);
          throw new Error(`Error during Composite API ${importAction.action} operation: ${errorDetails}`);
        }

        // Process results
        if (importAction.action === 'insert' && Array.isArray(response.data.records)) {
          response.data.records.forEach((res: any, idx: number) => {
            const dataIdx = i + idx;
            if (res.success && res.id && idColIdx !== -1) {
              resultDataSheet.data[dataIdx][idColIdx] = res.id;
            }
            if (!res.success && res.errors && res.errors.length > 0) {
              resultDataSheet.data[dataIdx][errorColIdx] = res.errors.map((e: any) => e.message).join(' | ');
            }
          });
        } else if ((importAction.action === 'update' || importAction.action === 'upsert') && Array.isArray(response.data.results)) {
          response.data.results.forEach((res: any, idx: number) => {
            const dataIdx = i + idx;
            if (!res.success && res.errors && res.errors.length > 0) {
              resultDataSheet.data[dataIdx][errorColIdx] = res.errors.map((e: any) => e.message).join(' | ');
            }
          });
        } else if (importAction.action === 'delete' && Array.isArray(response.data.results)) {
          response.data.results.forEach((res: any, idx: number) => {
            const dataIdx = i + idx;
            if (!res.success && res.errors && res.errors.length > 0) {
              resultDataSheet.data[dataIdx][errorColIdx] = res.errors.map((e: any) => e.message).join(' | ');
            }
          });
        }
      }

      return resultDataSheet;
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