import axios from 'axios';
import { CsvProcessor } from '../processor/CsvProcessor';
import { AppConfiguration } from '../model/AppConfiguration';
import { DataSheet } from '../model/DataSheet';
import { ImportAction, ActionType } from '../model/ImportAction';
import { ExportAction } from '../model/ExportAction';

const ID_COLUMN = 'Id';
const ERROR_INSERT_MESSAGE_LABEL = '_ErrorInsertMessage';
const ERROR_REMOVE_MESSAGE_LABEL = '_ErrorRemoveMessage';
const CSV_LINE_ENDING = 'LF';
const MS_IN_SEC = 1000;

interface JobInfo {
  id: string;
  state: string;
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
  errorMessage: string;
}

export class SalesforceBulkApiLoader {
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
   * Generates the CSV data and headers for the given operation.
   */
  private generateCsvPayload(
    operation: ActionType,
    dataSheet: DataSheet,
    importAction: ImportAction
  ): { headers: string[]; data: string[][] } {
    const indexIdField = dataSheet.columnNames.findIndex(
      (apiName) => apiName === ID_COLUMN
    );

    if (operation === 'delete') {
      // Only the Id field is needed for delete
      if (indexIdField < 0) {
        throw new Error(
          `The object ${importAction.objectName} doesn't have a column '${ID_COLUMN}'`
        );
      }
      const deleteHeaders = [ID_COLUMN];
      const deleteData = dataSheet.data
        .map(row => [row[indexIdField]])
        .filter(idArr => idArr[0]);
      return { headers: deleteHeaders, data: deleteData };
    } else {
      // For insert, update, upsert: use importFields if set and has more than one column, else use all columns
      let validIndexes: number[] = [];
      let headers: string[] = [];

      if (importAction.importFields && importAction.importFields.length > 1) {
        importAction.importFields.forEach(col => {
          const idx = dataSheet.columnNames.indexOf(col);
          if (idx !== -1) {
            validIndexes.push(idx);
            headers.push(col);
          }
        });
      } else {
        dataSheet.columnNames.forEach((col, idx) => {
          if (col && col.trim() !== '') {
            validIndexes.push(idx);
            headers.push(col);
          }
        });
      }

      let filteredData = dataSheet.data.map(row => validIndexes.map(idx => row[idx]));

      // Exclude data rows with an Id field when action is "insert"
      if (operation === 'insert' && indexIdField >= 0) {
        filteredData = filteredData.filter(row => !row[indexIdField]);
      }

      return { headers, data: filteredData };
    }
  }

  /**
   * Loads data into Salesforce using Bulk API v2 for insert, update, upsert, or delete.
   * Modifies the DataSheet with results.
   * @param instanceUrl The Salesforce instance URL.
   * @param accessToken The Salesforce access token.
   * @param importAction The configuration for the Salesforce object.
   * @param dataSheet The DataSheet object to load data from and modify with results.
   * @returns Boolean indicating if there was one or more records with error.
   */
  public async bulkApiOperation(
    instanceUrl: string,
    accessToken: string,
    importAction: ImportAction,
    dataSheet: DataSheet
  ): Promise<Boolean> {
    try {
      const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);

      // Prepare CSV payload
      const { headers, data } = this.generateCsvPayload(importAction.action, dataSheet, importAction);

      // If there is nodata to load we return
      if (data.length === 0) {
        console.info(`No data to import for ${dataSheet.name}.`);
        return true;
      }

      // For insert, update, upsert: we need a unique field or id field to map results
      let indexIdField = dataSheet.columnNames.findIndex(
        (apiName) => apiName === ID_COLUMN
      );
      let indexUniqueField = -1;
      if (importAction.uniqueField) {
        indexUniqueField = dataSheet.columnNames.findIndex(
          (apiName) => apiName === importAction.uniqueField
        );
      }
      if (indexUniqueField == -1 && indexIdField == -1) {
        console.info(`The object ${importAction.objectName} hasn't got a valid idFieldName or uniqueField, so Ids and errors will be recovered in order.`);
      }

      // Generate a map of data based on the unique field or id field
      const dataMap = new Map<string, number>();
      if (indexUniqueField >= 0) {
        dataSheet.data.forEach((_row, index) => {
          dataMap.set(dataSheet.data[index][indexUniqueField], index);
        });
      } else if (indexIdField >= 0) {
        dataSheet.data.forEach((_row, index) => {
          dataMap.set(dataSheet.data[index][indexIdField], index);
        });
      }

      // 1. Create Bulk API v2 job
      const jobRequest: any = {
        object: importAction.objectName,
        operation: importAction.action,
        contentType: 'CSV',
        lineEnding: CSV_LINE_ENDING,
      };
      if (importAction.action === 'upsert' && importAction.uniqueField) {
        jobRequest.externalIdFieldName = importAction.uniqueField;
      }
      const jobResponse = await axiosInstance.post('/jobs/ingest', jobRequest);

      const jobId = (jobResponse.data as JobInfo).id;
      if (!jobId) {
        throw new Error('Failed to create Bulk API v2 job: Job ID is missing.');
      }

      // 2. Prepare and upload data
      const csvData = CsvProcessor.generateCSV(headers, data);

      await axiosInstance.put(`/jobs/ingest/${jobId}/batches`, csvData, {
        headers: {
          'Content-Type': 'text/csv',
        },
      });

      // 3. Close the job
      await axiosInstance.patch(`/jobs/ingest/${jobId}`, {
        state: 'UploadComplete',
      });

      // 4. Wait for the job to complete
      let jobCompleted = false;
      let jobStatus;
      const startTime = Date.now();

      do {
        const elapsedTimeSec = (Date.now() - startTime) / MS_IN_SEC;
        if (elapsedTimeSec > this.appConfiguration.bulkApiMaxWaitSec) {
          throw new Error(
            `Bulk API v2 ${importAction.action} job for object ${importAction.objectName} exceeded the maximum wait time of ${this.appConfiguration.bulkApiMaxWaitSec} seconds.`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, this.appConfiguration.bulkApiPollIntervalSec * MS_IN_SEC));
        const statusResponse = await axiosInstance.get(`/jobs/ingest/${jobId}`);
        jobStatus = statusResponse.data as JobInfo;
        jobCompleted =
          jobStatus.state === 'JobComplete' ||
          jobStatus.state === 'Failed' ||
          jobStatus.state === 'Aborted';
      } while (!jobCompleted);

      if (jobStatus.state === 'Failed') {
        throw new Error(`Bulk API v2 ${importAction.action} job failed for object ${importAction.objectName}: ${jobStatus.errorMessage}`);
      }

      // 5. Process successful results
      if (importAction.action == "insert" && jobStatus.numberRecordsProcessed > 0) {
        // generate column for Id if not exist
        if (indexIdField < 0) {
          indexIdField = dataSheet.headerNames.length;
          dataSheet.headerNames.push(ID_COLUMN);
          dataSheet.columnNames.push(ID_COLUMN);
          dataSheet.data.forEach((row) => {
            row.push(''); // Placeholder for Id
          });
        }

        const successfulResults = await axiosInstance.get(
          `/jobs/ingest/${jobId}/successfulResults`,
          { headers: { Accept: 'text/csv' } },
        );
        const responseProcessed = CsvProcessor.parseCSV(successfulResults.data as string);
        responseProcessed.data.forEach((row, index) => {
          // Try to match by Id first, then by unique field
          let keyValue = '';
          if (indexIdField >= 0 && row.length > indexIdField + 2) {
            keyValue = row[indexIdField + 2];
          } else if (indexUniqueField >= 0 && row.length > indexUniqueField + 2) {
            keyValue = row[indexUniqueField + 2];
          }
          // Setthe Id in the Id field if exist
          const dataRowIndex = dataMap.get(keyValue) ?? index;
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexIdField] = row[0]; // Set Id
          }
        });
      }

      // 6. Process failed results
      let indexColumnErrorMessage;
      if (importAction.action == "delete") {
        indexColumnErrorMessage = dataSheet.headerNames.length;
        dataSheet.headerNames.push(ERROR_REMOVE_MESSAGE_LABEL);
        dataSheet.columnNames.push(ERROR_REMOVE_MESSAGE_LABEL);
      } else {
        indexColumnErrorMessage = dataSheet.headerNames.length;
        dataSheet.headerNames.push(ERROR_INSERT_MESSAGE_LABEL);
        dataSheet.columnNames.push(ERROR_INSERT_MESSAGE_LABEL);
      }
      dataSheet.data.forEach((row) => {
        row.push('');
      });

      if (jobStatus.numberRecordsFailed > 0) {
        const failedResults = await axiosInstance.get(
          `/jobs/ingest/${jobId}/failedResults`,
          { headers: { Accept: 'text/csv' } },
        );
        const responseFailed = CsvProcessor.parseCSV(failedResults.data as string);
        responseFailed.data.forEach((row, index) => {
          let dataRowIndex;
          if (importAction.action == "delete") {
            const idFieldValue = row[0]; // The Id is in the first column of the failed results
            dataRowIndex = dataMap.get(idFieldValue);
          } else {
            let keyValue = '';
            if (indexUniqueField >= 0 && row.length > indexUniqueField + 2) {
              keyValue = row[indexUniqueField + 2];
            } else if (indexIdField >= 0 && row.length > indexIdField + 2) {
              keyValue = row[indexIdField + 2];
            }
            if (keyValue !== '') {
              dataRowIndex = dataMap.get(keyValue) ?? index;
            } else {
              dataRowIndex = index;
            }
            // check we have a valid index
          }
          if (dataRowIndex !== undefined) {
            dataSheet.data[dataRowIndex][indexColumnErrorMessage] = row[1]; // The error message is in the second column
          }
        });
      }

      return jobStatus.numberRecordsFailed == 0;
    } catch (error: any) {
      throw new Error(`Error during Bulk API v2 ${importAction.action} operation: ${error.message} (Check the import configuration for this action)`);
    }
  }

  /**
   * Executes a SOQL query using Salesforce Bulk API v2 and returns the results as a DataSheet.
   * @param instanceUrl The Salesforce instance URL.
   * @param accessToken The Salesforce access token.
   * @param exportAction The ExportAction containing the SOQL query.
   * @param name The name to assign to the resulting DataSheet.
   * @returns Promise<DataSheet>
   */
  public async bulkApiQuery(
    instanceUrl: string,
    accessToken: string,
    exportAction: ExportAction,
    name: string
  ): Promise<DataSheet> {
    const axiosInstance = this.getAxiosInstance(instanceUrl, accessToken);

    // 1. Create Bulk API v2 query job
    const jobRequest = {
      operation: 'query',
      query: exportAction.query,
      contentType: 'CSV',
      lineEnding: CSV_LINE_ENDING,
    };
    const jobResponse = await axiosInstance.post('/jobs/query', jobRequest);
    const jobId = (jobResponse.data as JobInfo).id;
    if (!jobId) {
      throw new Error('Failed to create Bulk API v2 query job: Job ID is missing.');
    }

    // 2. Wait for the job to complete
    let jobCompleted = false;
    let jobStatus;
    const startTime = Date.now();

    do {
      const elapsedTimeSec = (Date.now() - startTime) / MS_IN_SEC;
      if (elapsedTimeSec > this.appConfiguration.bulkApiMaxWaitSec) {
        throw new Error(
          `Bulk API v2 query job exceeded the maximum wait time of ${this.appConfiguration.bulkApiMaxWaitSec} seconds.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.appConfiguration.bulkApiPollIntervalSec * MS_IN_SEC));
      const statusResponse = await axiosInstance.get(`/jobs/query/${jobId}`);
      jobStatus = statusResponse.data as JobInfo;
      jobCompleted =
        jobStatus.state === 'JobComplete' ||
        jobStatus.state === 'Failed' ||
        jobStatus.state === 'Aborted';
    } while (!jobCompleted);

    if (jobStatus.state === 'Failed') {
      throw new Error(`Bulk API v2 query job failed: ${jobStatus.errorMessage}`);
    }

    // 3. Retrieve results as CSV
    const resultsResponse = await axiosInstance.get(
      `/jobs/query/${jobId}/results`,
      { headers: { Accept: 'text/csv' } }
    );
    const csvString = resultsResponse.data as string;

    // 4. Parse CSV to DataSheet
    const parsed = CsvProcessor.parseCSV(csvString);
    const headerNames = parsed.headers;
    const columnNames = parsed.headers;
    const data = parsed.data;

    const dataSheet: DataSheet = {
      name,
      headerNames,
      columnNames,
      data,
    };

    return dataSheet;
  }
}